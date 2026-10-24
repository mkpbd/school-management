import { ZodError } from 'zod';
import { AppError, RateLimitError, ValidationError } from '../domain/errors.js';
import { mapPgError } from '../infrastructure/db/pg-errors.js';
import { problemTitle, type Locale } from '../infrastructure/i18n/format.js';

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: Array<{ path: string; code: string; message: string }>;
  details?: Record<string, unknown>;
  requestId: string;
}

export const PROBLEM_TYPE_BASE = 'https://docs.school-platform.local/errors/';

export function zodToValidationError(err: ZodError, prefix?: string): ValidationError {
  return new ValidationError(
    err.issues.map((i) => ({
      path: [prefix, ...i.path.map(String)].filter(Boolean).join('.'),
      code: i.code,
      message: i.message,
    })),
  );
}

/** Normalises any thrown value to an AppError (or undefined = unexpected 500). */
export function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return zodToValidationError(err);
  return mapPgError(err);
}

/** RFC 9457 problem body. Stack traces and SQL never leave the server. */
export function toProblem(
  err: unknown,
  requestId: string,
  locale: Locale,
): { body: ProblemBody; headers: Record<string, string> } {
  const app = toAppError(err);
  const headers: Record<string, string> = {};
  if (!app) {
    return {
      body: {
        type: `${PROBLEM_TYPE_BASE}INTERNAL_ERROR`,
        title: problemTitle('INTERNAL_ERROR', locale, 'Internal error'),
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId,
      },
      headers,
    };
  }
  if (app instanceof RateLimitError) headers['Retry-After'] = String(app.retryAfterSec);
  return {
    body: {
      type: `${PROBLEM_TYPE_BASE}${app.code}`,
      title: problemTitle(app.code, locale, app.message),
      status: app.status,
      code: app.code,
      detail: app.message,
      ...(app instanceof ValidationError ? { errors: app.fieldErrors } : {}),
      ...(app.exposeDetails && app.details ? { details: app.details } : {}),
      requestId,
    },
    headers,
  };
}
