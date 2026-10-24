import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import pg from 'pg';

/** Drizzle database handle (pool-backed). Query builder only: no relational schema registered. */
export type Database = NodePgDatabase;

/** A transaction handle. Repositories always receive one of these (via UnitOfWork.db()). */
export type Executor = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

let parsersInstalled = false;

/** int8 -> number (paisa fits in a safe integer); fail loudly instead of silently losing precision. */
function installTypeParsers(): void {
  if (parsersInstalled) return;
  pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${value} exceeds Number.MAX_SAFE_INTEGER`);
    return n;
  });
  parsersInstalled = true;
}

export interface PoolOptions {
  connectionString: string;
  max: number;
  statementTimeoutMs: number;
  applicationName: string;
}

export function createPool(o: PoolOptions): pg.Pool {
  installTypeParsers();
  return new pg.Pool({
    connectionString: o.connectionString,
    max: o.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: o.statementTimeoutMs,
    application_name: o.applicationName,
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, casing: 'snake_case' });
}
