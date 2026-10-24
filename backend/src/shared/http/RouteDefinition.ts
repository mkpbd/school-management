import type { Request, Response } from 'express';
import type { z, ZodType } from 'zod';
import type { PermissionCode } from '../application/RequestContext.js';
import type { RateLimitRule } from '../infrastructure/cache/rateLimiter.js';

export interface RouteSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  /** documented (and validated in dev/test) response `data` schema */
  response?: ZodType;
}

type Infer<T, Fallback> = T extends ZodType ? z.output<T> : Fallback;

export interface RouteInput<S extends RouteSchemas> {
  params: Infer<S['params'], Record<string, string>>;
  query: Infer<S['query'], Record<string, unknown>>;
  body: Infer<S['body'], undefined>;
}

/** What a handler returns; mountController serialises it as `{ data, meta? }`. Return undefined if you responded yourself. */
export interface RouteResult {
  status?: number;
  data?: unknown;
  meta?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type AuthMode =
  | 'user' // access token required (cookie + CSRF, or bearer)
  | 'optional' // anonymous allowed, identity used if present
  | 'none' // public (login, OTP, health, verify)
  | 'webhook'; // public + raw body captured (signature checked by the use case)

export interface RouteDefinition<S extends RouteSchemas = RouteSchemas> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express path relative to the controller basePath, e.g. '/:id/complete' */
  path: string;
  summary: string;
  description?: string;
  auth?: AuthMode;
  permission?: PermissionCode;
  schema?: S;
  /** Requires an Idempotency-Key header; completed responses are replayed. */
  idempotent?: boolean;
  rateLimit?: RateLimitRule & { by: 'ip' | 'user' };
  /** Body size limit override, e.g. '10mb' for imports */
  bodyLimit?: string;
  successStatus?: number;
  handler: (input: RouteInput<S>, req: Request, res: Response) => Promise<RouteResult | undefined>;
}

/** Identity helper that keeps the schema generic for typed handler inputs. */
export function defineRoute<S extends RouteSchemas>(route: RouteDefinition<S>): RouteDefinition {
  return route as unknown as RouteDefinition;
}
