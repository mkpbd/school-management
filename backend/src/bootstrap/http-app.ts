import '../shared/http/types.js';
import { timingSafeEqual } from 'node:crypto';
import type { AwilixContainer } from 'awilix';
import compression from 'compression';
import cors from 'cors';
import { mountLocalBlobRoutes } from '../shared/http/localBlobRoutes.js';
import type { FileStorage } from '../shared/application/ports.js';
import { LocalDiskFileStorage, LOCAL_BLOB_PATH } from '../shared/infrastructure/storage/LocalDiskFileStorage.js';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IdentityProvider } from '../shared/application/auth.js';
import type { RateLimiterFactory } from '../shared/infrastructure/cache/rateLimiter.js';
import { RateLimits } from '../shared/infrastructure/cache/rateLimiter.js';
import type { TokenService } from '../shared/infrastructure/crypto/TokenService.js';
import type { IdempotencyStore } from '../shared/infrastructure/idempotency/IdempotencyStore.js';
import { errorHandler, globalRateLimit, notFound, requestScope } from '../shared/http/middleware.js';
import { mountController, type HttpKit } from '../shared/http/mountController.js';
import { cookieNames } from '../shared/http/cookies.js';
import { OpenApiBuilder } from '../shared/http/openapi.js';
import { mountSwaggerUi } from '../shared/http/swaggerUi.js';
import type { ModuleDefinition } from '../shared/module.js';
import type { Cradle } from './container.js';

export const API_PREFIX = '/api/v1';

/**
 * Express application (docs/backend/cross-cutting.md §3.1 middleware order):
 * requestScope → logging → helmet → cors → compression → global rate limit → body parsers → routes → 404 → errors
 */
export function createHttpApp(
  container: AwilixContainer<Cradle>,
  modules: ModuleDefinition[],
): { app: Express; openapi: OpenApiBuilder } {
  const { config, logger, metrics, orgId } = container.cradle;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.set('query parser', 'extended');

  app.use(requestScope({ container, orgId, metrics }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') || req.url === '/metrics' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'info' : 'debug',
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
        'X-Campus-Id',
        'Idempotency-Key',
        'If-Match',
        'X-Request-Id',
        'Accept-Language',
      ],
      exposedHeaders: ['X-Request-Id', 'ETag', 'Location', 'Retry-After', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(compression({ threshold: 1024 }));
  app.use(globalRateLimit(container.resolve<RateLimiterFactory>('limiters'), RateLimits.global));

  // webhooks capture the raw body themselves (signature verification)
  const json = express.json({ limit: '1mb' });
  const urlencoded = express.urlencoded({ extended: false, limit: '256kb' });
  const parsers: RequestHandler = (req, res, next) =>
    req.path.startsWith(`${API_PREFIX}/webhooks`) || req.path.startsWith(LOCAL_BLOB_PATH)
      ? next()
      : json(req, res, (err?: unknown) => (err ? next(err) : urlencoded(req, res, next)));
  app.use(parsers);

  const openapi = new OpenApiBuilder(cookieNames(config.COOKIE_SECURE).access);
  const kit: HttpKit = {
    orgId,
    tokens: container.resolve<TokenService>('tokens'),
    identities: () => container.resolve<IdentityProvider>('identityProvider'),
    limiters: container.resolve<RateLimiterFactory>('limiters'),
    idempotency: container.resolve<IdempotencyStore>('idempotency'),
    openapi,
    secureCookies: config.COOKIE_SECURE,
    validateResponses: config.NODE_ENV !== 'production',
  };

  const router = express.Router();
  for (const module of modules) {
    for (const controller of module.controllers?.() ?? []) {
      mountController(router, controller, controller.mount === 'root' ? '' : API_PREFIX, kit);
    }
  }

  if (config.SWAGGER_ENABLED ?? config.NODE_ENV !== 'production') {
    mountSwaggerUi(app, { basePath: `${API_PREFIX.replace(/\/v1$/, '')}/docs`, specUrl: `${API_PREFIX}/docs.json` });
  }

  const storage = container.resolve<FileStorage>('fileStorage');
  if (storage instanceof LocalDiskFileStorage) mountLocalBlobRoutes(router, storage);

  router.get(`${API_PREFIX}/docs.json`, (_req, res) => {
    res.json(openapi.document(`${config.PUBLIC_BASE_URL}`));
  });

  router.get('/metrics', async (req, res) => {
    const expected = config.METRICS_TOKEN;
    const given = req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      res.status(404).end();
      return;
    }
    res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  });

  app.use(router);
  app.use(notFound);
  app.use(errorHandler(logger));
  return { app, openapi };
}
