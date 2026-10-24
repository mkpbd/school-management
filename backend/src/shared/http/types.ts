import type { AwilixContainer } from 'awilix';
import type { RequestContext } from '../application/RequestContext.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** ULID-like request id (X-Request-Id). */
      requestId: string;
      /** awilix child container for this request (scoped use cases, uow, repositories). */
      scope: AwilixContainer;
      /** Set by the authenticate middleware (anonymous context before). */
      ctx: RequestContext;
      /** How the caller authenticated: cookie (web, CSRF-checked) or bearer (apps). */
      authKind?: 'cookie' | 'bearer' | 'apiKey' | 'device' | 'none';
      /** Route template for metrics/logs, e.g. /api/v1/files/:id/url */
      routeTemplate?: string;
      /** Raw body, captured only for webhook routes (signature verification). */
      rawBody?: Buffer;
    }
  }
}

export {};
