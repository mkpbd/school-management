import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../../application/RequestContext.js';
import type { TransactionRunner } from '../../application/ports.js';
import type { Database, Executor } from './client.js';
import { RETRYABLE_CODES, pgErrorOf } from './pg-errors.js';

interface TxState {
  tx: Executor;
  readOnly: boolean;
  afterCommit: Array<() => Promise<void> | void>;
}

const storage = new AsyncLocalStorage<TxState>();

/**
 * One request/job = one transaction with the RLS context (docs/backend/cross-cutting.md §6.2).
 *
 * Every transaction first sets transaction-local settings read by PostgreSQL:
 *   app.org_id, app.user_id, app.campus_ids ('*' or csv), app.request_id, app.client_ip
 * -> row-level security policies (core.campus_visible / core.org_visible) and the audit trigger.
 * `set_config(..., true)` is transaction-scoped, so it is safe behind PgBouncer in transaction mode.
 */
export class UnitOfWork implements TransactionRunner {
  private readonly db: Database;
  private readonly replicaDb: Database;
  private readonly ctx: RequestContext;

  constructor(deps: { db: Database; replicaDb: Database; ctx: RequestContext }) {
    this.db = deps.db;
    this.replicaDb = deps.replicaDb;
    this.ctx = deps.ctx;
  }

  /** The current transaction. Repositories call this; outside run() it throws (no RLS context = no access). */
  tx(): Executor {
    const state = storage.getStore();
    if (!state) throw new Error('Database access outside UnitOfWork.run(): RLS context is not set');
    return state.tx;
  }

  isActive(): boolean {
    return storage.getStore() !== undefined;
  }

  /** Runs after a successful commit of the outermost transaction (e.g. enqueue jobs, warm caches). */
  afterCommit(fn: () => Promise<void> | void): void {
    const state = storage.getStore();
    if (!state) throw new Error('afterCommit() outside UnitOfWork.run()');
    state.afterCommit.push(fn);
  }

  async run<T>(fn: () => Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    const current = storage.getStore();
    if (current) {
      // nested use case / public-API call joins the outer transaction; an actual write inside a read-only
      // transaction is rejected by PostgreSQL ("cannot execute ... in a read-only transaction")
      return fn();
    }
    const readOnly = options.readOnly ?? false;
    const base = readOnly ? this.replicaDb : this.db;
    const afterCommit: TxState['afterCommit'] = [];

    const result = await withRetry(() =>
      base.transaction(
        async (tx) => {
          await this.applyContext(tx);
          afterCommit.length = 0;
          return storage.run({ tx, readOnly, afterCommit }, fn);
        },
        { isolationLevel: 'read committed', accessMode: readOnly ? 'read only' : 'read write' },
      ),
    );
    for (const hook of afterCommit) await hook();
    return result;
  }

  private async applyContext(tx: Executor): Promise<void> {
    const c = this.ctx;
    const campusIds = c.campusIds === '*' ? '*' : c.campusIds.join(',');
    await tx.execute(sql`SELECT set_config('app.org_id', ${c.orgId}, true),
                                set_config('app.user_id', ${c.userId ?? ''}, true),
                                set_config('app.campus_ids', ${campusIds}, true),
                                set_config('app.request_id', ${c.requestId}, true),
                                set_config('app.client_ip', ${c.ip ?? ''}, true)`);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = pgErrorOf(err)?.code;
      if (i >= attempts || !code || !RETRYABLE_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** i + Math.random() * 20));
    }
  }
}
