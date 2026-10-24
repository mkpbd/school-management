import type { AppError } from '../../domain/errors.js';
import { ConflictError, DependencyError, ForbiddenError, InvariantError } from '../../domain/errors.js';

/** The node-postgres error shape (drizzle wraps it in DrizzleQueryError.cause). */
export interface PgError {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
  schema?: string;
  column?: string;
  detail?: string;
}

/** Walks the cause chain to the PostgreSQL error, if any. */
export function pgErrorOf(err: unknown): PgError | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    const c = current as { code?: unknown; cause?: unknown; severity?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code) && 'severity' in c) return c as unknown as PgError;
    current = c.cause;
  }
  return undefined;
}

export const RETRYABLE_CODES = new Set(['40001', '40P01']); // serialization failure, deadlock

/**
 * Business-trigger messages and constraints from db/migrations mapped to stable API error codes.
 * Keep in sync with docs/backend/cross-cutting.md §17.
 */
const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/marks are locked/, 'PAPER_LOCKED'],
  [/reverse allocations before voiding/, 'INVOICE_HAS_PAYMENTS'],
  [/lines of issued invoice .* are immutable/, 'INVOICE_LINE_IMMUTABLE'],
  [/invoice .* is void, draft or missing/, 'INVOICE_NOT_PAYABLE'],
  [/invoice .* is void/, 'INVOICE_VOID'],
  [/cannot return to draft/, 'INVOICE_STATUS_INVALID'],
  [/is not balanced/, 'JOURNAL_UNBALANCED'],
  [/fiscal period is locked/, 'FISCAL_PERIOD_LOCKED'],
];

const CHECK_RULES: Array<[table: string, constraintPrefix: string, code: string]> = [
  ['invoice_line', 'invoice_line_check', 'ALLOCATION_EXCEEDS_DUE'],
  ['invoice', 'invoice_check', 'ALLOCATION_EXCEEDS_DUE'],
  ['stock_balance', 'stock_balance_qty_on_hand_check', 'INSUFFICIENT_STOCK'],
  ['staff_leave_balance', 'staff_leave_balance_check', 'LEAVE_BALANCE_INSUFFICIENT'],
];

/** Maps a PostgreSQL error to an AppError; returns undefined for non-database errors. */
export function mapPgError(err: unknown): AppError | undefined {
  const pg = pgErrorOf(err);
  if (!pg) return undefined;
  const details = { constraint: pg.constraint, table: pg.table };
  switch (pg.code) {
    case '23505':
      return new ConflictError('DUPLICATE', 'A record with the same unique value already exists', details);
    case '23P01':
      return new ConflictError('OVERLAP', 'This overlaps an existing record (dates/ranges)', details);
    case '23503':
      return new InvariantError('REFERENCE_INVALID', 'A referenced record does not exist or is still in use', details);
    case '23502':
      return new InvariantError(
        'REQUIRED_FIELD_MISSING',
        `Missing required value${pg.column ? `: ${pg.column}` : ''}`,
        details,
      );
    case '23514':
    case 'P0001': {
      for (const [re, code] of MESSAGE_RULES)
        if (re.test(pg.message)) return new InvariantError(code, pg.message, details);
      for (const [table, prefix, code] of CHECK_RULES) {
        if (pg.table === table && pg.constraint?.startsWith(prefix))
          return new InvariantError(code, pg.message, details);
      }
      return new InvariantError('CHECK_VIOLATION', 'The data violates a business rule', details);
    }
    case '42501':
      return new ForbiddenError('OUT_OF_SCOPE', 'Not permitted for this campus or record');
    case '40001':
    case '40P01':
      return new DependencyError('CONCURRENT_UPDATE', 'Concurrent update; please retry');
    case '57014':
      return new DependencyError('QUERY_TIMEOUT', 'The database took too long to respond');
    case '22P02':
    case '22007':
    case '22008':
      return new InvariantError('INVALID_VALUE', 'A value has an invalid format', details);
    default:
      return undefined;
  }
}
