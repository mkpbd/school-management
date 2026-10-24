import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import type { ZodType } from 'zod';
import type { IdentityProvider } from '../application/auth.js';
import { AuthError, ValidationError } from '../domain/errors.js';
import type { RateLimiterFactory } from '../infrastructure/cache/rateLimiter.js';
import { IdempotencyStore } from '../infrastructure/idempotency/IdempotencyStore.js';
import type { BaseController } from './BaseController.js';
import { authenticate, authorize, rateLimit, type TokenVerifier } from './middleware.js';
import type { OpenApiBuilder } from './openapi.js';
import { zodToValidationError } from './problem.js';
import type { RouteDefinition, RouteResult } from './RouteDefinition.js';

export interface HttpKit {
  orgId: string;
  tokens: TokenVerifier;
  identities: () => IdentityProvider;
  limiters: RateLimiterFactory;
  idempotency: IdempotencyStore;
  openapi: OpenApiBuilder;
  secureCookies: boolean;
  validateResponses: boolean;
}

const IDEMPOTENCY_KEY_RE = /^[\w-]{8,100}$/;

function parsePart(schema: ZodType | undefined, value: unknown, part: string): unknown {
  if (!schema) return value;
  const r = schema.safeParse(value ?? (part === 'body' ? undefined : {}));
  if (!r.success) throw zodToValidationError(r.error, part);
  return r.data;
}

/**
 * Builds the middleware chain for every route of a controller and registers it in OpenAPI
 * (docs/backend/cross-cutting.md §3.2). Order: [raw body] → authenticate → rate limit → authorize → handler
 * (validation, idempotency, response envelope inside the handler wrapper).
 */
export function mountController(router: Router, controller: BaseController, prefix: string, kit: HttpKit): void {
  for (const route of controller.routes()) {
    const fullPath = `${prefix}${controller.basePath}${route.path}`.replace(/\/+$/, '') || '/';
    const chain: RequestHandler[] = [];
    const template: RequestHandler = (req, _res, next) => {
      req.routeTemplate = fullPath;
      next();
    };
    chain.push(template);
    if (route.bodyLimit) chain.push(express.json({ limit: route.bodyLimit }));
    if (route.auth === 'webhook') {
      chain.push(express.raw({ type: '*/*', limit: '1mb' }), (req, _res, next) => {
        req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        req.body = parseWebhookBody(req);
        next();
      });
    }
    const auth = route.auth ?? 'user';
    if (auth === 'user' || auth === 'optional') {
      chain.push(
        authenticate({
          tokens: kit.tokens,
          identities: kit.identities,
          orgId: kit.orgId,
          secureCookies: kit.secureCookies,
          required: auth === 'user',
        }),
      );
    }
    if (route.rateLimit) chain.push(rateLimit(kit.limiters, route.rateLimit));
    if (route.permission) chain.push(authorize(route.permission));
    chain.push(handlerWrapper(route, kit));

    router[route.method](fullPath, ...chain);
    kit.openapi.add(controller, fullPath, route);
  }
}

function handlerWrapper(route: RouteDefinition, kit: HttpKit): RequestHandler {
  return async (req: Request, res: Response) => {
    const input = {
      params: parsePart(route.schema?.params, req.params, 'params'),
      query: parsePart(route.schema?.query, req.query, 'query'),
      body: parsePart(route.schema?.body, req.body, 'body'),
    } as Parameters<RouteDefinition['handler']>[0];

    let idem: { userId: string; key: string } | undefined;
    if (route.idempotent) {
      const key = req.header('Idempotency-Key');
      if (!key || !IDEMPOTENCY_KEY_RE.test(key)) {
        throw new ValidationError([
          { path: 'header.Idempotency-Key', code: 'required', message: 'Idempotency-Key header is required' },
        ]);
      }
      if (!req.ctx.userId) throw new AuthError();
      const hash = IdempotencyStore.hashRequest(req.method, req.originalUrl.split('?')[0]!, req.body);
      const begin = await kit.idempotency.begin(req.ctx.userId, key, `${req.method} ${req.routeTemplate}`, hash);
      if (begin.kind === 'replay') {
        res.setHeader('Idempotent-Replayed', 'true');
        if (begin.status === 204) res.status(204).end();
        else res.status(begin.status).json(begin.body);
        return;
      }
      idem = { userId: req.ctx.userId, key };
    }

    let result: RouteResult | undefined;
    try {
      result = await route.handler(input, req, res);
    } catch (err) {
      if (idem) await kit.idempotency.release(idem.userId, idem.key);
      throw err;
    }
    if (!result) return; // handler wrote the response itself

    const status = result.status ?? route.successStatus ?? 200;
    const body =
      status === 204 ? undefined : { data: result.data ?? null, ...(result.meta ? { meta: result.meta } : {}) };
    if (kit.validateResponses && route.schema?.response && body) {
      const check = route.schema.response.safeParse(body.data);
      if (!check.success)
        throw new Error(
          `Response contract violation on ${route.method.toUpperCase()} ${req.routeTemplate}: ${check.error.message}`,
        );
    }
    if (idem) await kit.idempotency.complete(idem.userId, idem.key, status, body);
    if (result.headers) res.set(result.headers);
    if (status === 204) res.status(204).end();
    else res.status(status).json(body);
  };
}

function parseWebhookBody(req: Request): unknown {
  const raw = req.rawBody?.toString('utf8') ?? '';
  const type = req.header('Content-Type') ?? '';
  if (!raw) return {};
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return {};
}
