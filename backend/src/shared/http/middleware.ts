import { randomUUID, timingSafeEqual } from 'node:crypto';
import { asValue, type AwilixContainer } from 'awilix';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import type { AccessClaims, IdentityProvider } from '../application/auth.js';
import { anonymousContext, type PermissionCode, type RequestContext } from '../application/RequestContext.js';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError, PayloadTooLargeError } from '../domain/errors.js';
import type { RateLimiterFactory, RateLimitRule } from '../infrastructure/cache/rateLimiter.js';
import { logContext } from '../infrastructure/observability/logger.js';
import type { Metrics } from '../infrastructure/observability/metrics.js';
import { cookieNames, parseCookies } from './cookies.js';
import { toProblem } from './problem.js';

export interface TokenVerifier {
  verifyAccess(token: string): Promise<AccessClaims>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUEST_ID_RE = /^[\w.-]{8,64}$/;

/** 1. Request id + per-request DI scope + anonymous context + log correlation + HTTP metrics. */
export function requestScope(deps: { container: AwilixContainer; orgId: string; metrics: Metrics }): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('X-Request-Id');
    req.requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    req.ctx = anonymousContext(deps.orgId, req.requestId, req.ip);
    req.scope = deps.container.createScope();
    req.scope.register({ ctx: asValue(req.ctx) });
    const started = performance.now();
    res.on('finish', () => {
      deps.metrics.httpDuration.observe(
        { method: req.method, route: req.routeTemplate ?? 'unmatched', status: String(res.statusCode) },
        (performance.now() - started) / 1000,
      );
      void req.scope.dispose();
    });
    logContext.run({ requestId: req.requestId, orgId: deps.orgId }, () => next());
  };
}

function setContext(req: Request, ctx: RequestContext): void {
  req.ctx = ctx;
  req.scope.register({ ctx: asValue(ctx) });
  const store = logContext.getStore();
  if (store) {
    store.userId = ctx.userId;
    if (ctx.activeCampusId) store.campusId = ctx.activeCampusId;
  }
}

/**
 * 2. Authentication (docs/backend/cross-cutting.md §4): bearer token (apps) or access cookie (web, CSRF-checked).
 * Replaces the anonymous context with the user's context and validates X-Campus-Id.
 */
export function authenticate(deps: {
  tokens: TokenVerifier;
  identities: () => IdentityProvider;
  orgId: string;
  secureCookies: boolean;
  required: boolean;
}): RequestHandler {
  const names = cookieNames(deps.secureCookies);
  return async (req, _res, next) => {
    const bearer = req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const cookies = bearer ? {} : parseCookies(req);
    const token = bearer ?? cookies[names.access];
    if (!token) {
      if (deps.required) throw new AuthError();
      return next();
    }
    const claims = await deps.tokens.verifyAccess(token);
    if (claims.org !== deps.orgId) throw new AuthError('TOKEN_INVALID', 'Token is for another organisation');

    if (!bearer && !SAFE_METHODS.has(req.method)) {
      // double-submit CSRF: header must equal the csrf cookie
      const header = req.header('X-CSRF-Token') ?? '';
      const cookie = cookies[names.csrf] ?? '';
      if (!header || header.length !== cookie.length || !timingSafeEqual(Buffer.from(header), Buffer.from(cookie))) {
        throw new ForbiddenError('CSRF_FAILED', 'Missing or invalid CSRF token');
      }
    }

    const identity = await deps.identities().resolve(claims);
    const campusHeader = req.header('X-Campus-Id') ?? undefined;
    if (campusHeader) {
      const allowed = identity.grants.campusIds === '*' || identity.grants.campusIds.includes(campusHeader);
      if (!allowed) throw new ForbiddenError('OUT_OF_SCOPE', 'Campus is outside your access');
    }
    const locale = req.acceptsLanguages('bn', 'en') === 'bn' ? 'bn' : identity.locale;
    req.authKind = bearer ? 'bearer' : 'cookie';
    setContext(req, {
      requestId: req.requestId,
      orgId: identity.orgId,
      userId: identity.userId,
      userType: identity.userType,
      locale,
      campusIds: identity.grants.campusIds,
      activeCampusId: campusHeader,
      grants: identity.grants,
      staffId: identity.staffId,
      guardianId: identity.guardianId,
      studentId: identity.studentId,
      ip: req.ip,
      userAgent: req.header('User-Agent') ?? undefined,
    });
    next();
  };
}

/** 3. Route permission (first authorization layer). */
export function authorize(permission: PermissionCode): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx.userId) throw new AuthError();
    if (!req.ctx.grants.byPermission[permission]?.length) {
      throw new ForbiddenError('FORBIDDEN', `Missing permission ${permission}`);
    }
    next();
  };
}

/** Route-specific rate limit (login, OTP, payments). */
export function rateLimit(limiters: RateLimiterFactory, rule: RateLimitRule & { by: 'ip' | 'user' }): RequestHandler {
  return async (req, _res, next) => {
    const subject = rule.by === 'user' && req.ctx.userId ? req.ctx.userId : (req.ip ?? 'unknown');
    await limiters.consume(rule, subject);
    next();
  };
}

/** Global per-user/IP limit (cheap, before routing). */
export function globalRateLimit(limiters: RateLimiterFactory, rule: RateLimitRule): RequestHandler {
  return async (req, _res, next) => {
    await limiters.consume(rule, req.ip ?? 'unknown');
    next();
  };
}

export const notFound: RequestHandler = (_req, _res, next: NextFunction) => next(new NotFoundError('Route not found'));

/** Last middleware: everything becomes RFC 9457 problem+json. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const parserError = err as { type?: string } | undefined;
    if (parserError?.type === 'entity.too.large') err = new PayloadTooLargeError();
    if (parserError?.type === 'entity.parse.failed') err = new BadRequestError('MALFORMED_JSON', 'Malformed JSON body');
    const locale = req.ctx?.locale ?? (req.acceptsLanguages?.('bn', 'en') === 'bn' ? 'bn' : 'en');
    const { body, headers } = toProblem(err, req.requestId ?? 'n/a', locale);
    if (body.status >= 500) logger.error({ err, route: req.routeTemplate }, 'unhandled error');
    else logger.debug({ code: body.code, route: req.routeTemplate }, 'request rejected');
    if (res.headersSent) return;
    res.status(body.status).set(headers).type('application/problem+json').json(body);
  };
}
