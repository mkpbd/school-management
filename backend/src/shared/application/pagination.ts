import { ValidationError } from '../domain/errors.js';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageRequest {
  limit: number;
  cursor?: string | undefined;
}

/** Keyset cursor: the sort values of the last row + its id, base64url JSON (opaque to clients). */
export interface Cursor {
  k: Array<string | number | null>;
  id: string;
}

export const MAX_PAGE_SIZE = 200;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (!Array.isArray(parsed.k) || typeof parsed.id !== 'string') throw new Error('shape');
    return parsed;
  } catch {
    throw new ValidationError([{ path: 'cursor', code: 'invalid_cursor', message: 'Invalid pagination cursor' }]);
  }
}

/** Builds a page from `limit + 1` fetched rows. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
