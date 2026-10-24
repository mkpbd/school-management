import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ConflictError, InvariantError } from '../../domain/errors.js';
import type { Database } from '../db/client.js';
import { idempotencyKey } from '../db/schema/sys.js';

export type IdempotencyBegin = { kind: 'started' } | { kind: 'replay'; status: number; body: unknown };

/**
 * Idempotency-Key handling backed by sys.idempotency_key (docs/backend/cross-cutting.md §8).
 * The primary key (user_id, key) is the lock: a concurrent duplicate gets 409, a completed one is replayed.
 * Runs in its own short transactions, outside the business UnitOfWork.
 */
export class IdempotencyStore {
  constructor(private readonly db: Database) {}

  static hashRequest(method: string, path: string, body: unknown): Buffer {
    return createHash('sha256')
      .update(`${method} ${path}\n${canonicalJson(body)}`)
      .digest();
  }

  async begin(userId: string, key: string, methodPath: string, requestHash: Buffer): Promise<IdempotencyBegin> {
    const inserted = await this.db
      .insert(idempotencyKey)
      .values({ userId, key, methodPath, requestHash, status: 'in_progress' })
      .onConflictDoNothing()
      .returning({ key: idempotencyKey.key });
    if (inserted.length) return { kind: 'started' };

    const [existing] = await this.db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
    if (!existing) return this.begin(userId, key, methodPath, requestHash); // expired+deleted meanwhile
    if (existing.expiresAt < new Date()) {
      await this.release(userId, key);
      return this.begin(userId, key, methodPath, requestHash);
    }
    if (!existing.requestHash.equals(requestHash) || existing.methodPath !== methodPath) {
      throw new InvariantError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request');
    }
    if (existing.status === 'in_progress') {
      throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed');
    }
    return { kind: 'replay', status: existing.responseCode ?? 200, body: existing.responseBody };
  }

  async complete(userId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKey)
      .set({ status: 'completed', responseCode: status, responseBody: body ?? null })
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
  }

  /** Called when the handler failed: the client may retry with the same key. */
  async release(userId: string, key: string): Promise<void> {
    await this.db.delete(idempotencyKey).where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
  }

  async purgeExpired(): Promise<number> {
    const r = await this.db.execute(sql`DELETE FROM sys.idempotency_key WHERE expires_at < now()`);
    return r.rowCount ?? 0;
  }
}

/** JSON with sorted object keys, so semantically equal bodies hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}
