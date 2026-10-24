/**
 * Application error family. Every error carries a stable `code` (documented contract for clients)
 * and an HTTP status; the error handler turns them into RFC 9457 problem+json responses.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    /** details are sent to the client (problem+json `details`); off by default: they may name tables / constraints */
    readonly exposeDetails = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly status = 422;
  constructor(
    readonly fieldErrors: Array<{ path: string; code: string; message: string }>,
    message = 'Request validation failed',
  ) {
    super('VALIDATION_FAILED', message);
  }
}

/** A business rule was violated (422). */
export class InvariantError extends AppError {
  readonly status = 422;
}

export class NotFoundError extends AppError {
  readonly status = 404;
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(code, message);
  }
}

export class AuthError extends AppError {
  readonly status = 401;
  constructor(code = 'UNAUTHENTICATED', message = 'Authentication required') {
    super(code, message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  constructor(code = 'FORBIDDEN', message = 'You do not have permission for this action') {
    super(code, message);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
}

export class StaleWriteError extends AppError {
  readonly status = 412;
  constructor(message = 'The resource was changed by someone else; reload and retry') {
    super('PRECONDITION_FAILED', message);
  }
}

export class RateLimitError extends AppError {
  readonly status = 429;
  constructor(readonly retryAfterSec: number) {
    super('RATE_LIMITED', 'Too many requests');
  }
}

export class DependencyError extends AppError {
  readonly status = 503;
}

/** Malformed request that could not be parsed (400). */
export class BadRequestError extends AppError {
  readonly status = 400;
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  constructor() {
    super('PAYLOAD_TOO_LARGE', 'Request body too large');
  }
}
