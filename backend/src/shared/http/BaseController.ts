import type { Request } from 'express';
import type { Page } from '../application/pagination.js';
import type { RouteDefinition, RouteResult } from './RouteDefinition.js';

/**
 * Class-based controller (docs/backend/cross-cutting.md §3.2). Controllers are singletons and thin:
 * they resolve a request-scoped use case from `req.scope` and translate its result to HTTP.
 */
export abstract class BaseController {
  /** Mounted under /api/v1 unless `mount` is 'root'. */
  abstract readonly basePath: string;
  /** OpenAPI tag */
  abstract readonly tag: string;
  readonly mount: 'api' | 'root' = 'api';

  abstract routes(): RouteDefinition[];

  protected resolve<T>(req: Request, name: string): T {
    return req.scope.resolve<T>(name);
  }

  protected ok(data: unknown, meta?: Record<string, unknown>): RouteResult {
    return { status: 200, data, ...(meta ? { meta } : {}) };
  }

  protected created(data: unknown, location?: string): RouteResult {
    return { status: 201, data, ...(location ? { headers: { Location: location } } : {}) };
  }

  protected accepted(jobId: string): RouteResult {
    return { status: 202, data: { jobId, status: 'queued' } };
  }

  protected noContent(): RouteResult {
    return { status: 204 };
  }

  protected page<T>(page: Page<T>): RouteResult {
    return { status: 200, data: page.items, meta: { nextCursor: page.nextCursor } };
  }

  /** ETag = row_version for optimistic concurrency (If-Match on updates). */
  protected withEtag(result: RouteResult, rowVersion: number): RouteResult {
    return { ...result, headers: { ...result.headers, ETag: `"${rowVersion}"` } };
  }
}

/** Parses `If-Match: "3"` into 3 (or undefined). */
export function ifMatchVersion(req: Request): number | undefined {
  const raw = req.header('If-Match');
  if (!raw) return undefined;
  const n = Number(raw.replace(/^W\//, '').replace(/"/g, ''));
  return Number.isInteger(n) ? n : undefined;
}
