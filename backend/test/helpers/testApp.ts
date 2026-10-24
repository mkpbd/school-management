import { randomUUID } from 'node:crypto';
import type { AwilixContainer } from 'awilix';
import type { Express } from 'express';
import pg from 'pg';
import { loadConfig } from '../../src/bootstrap/config.js';
import { buildContainer, disposeContainer, type Cradle } from '../../src/bootstrap/container.js';
import { createHttpApp } from '../../src/bootstrap/http-app.js';
import { createModules } from '../../src/bootstrap/modules.js';
import { PasswordHasher } from '../../src/shared/infrastructure/crypto/PasswordHasher.js';
import type { MemoryCache } from '../../src/shared/infrastructure/cache/cache.js';
import type { ModuleDefinition } from '../../src/shared/module.js';
import type { Clock } from '../../src/shared/domain/Clock.js';

export interface TestApp {
  app: Express;
  container: AwilixContainer<Cradle>;
  modules: ModuleDefinition[];
  owner: OwnerDb;
  close(): Promise<void>;
}

/** Full application wired like production, but with inline jobs and in-memory cache/rate limits. */
export async function createTestApp(
  extraModules: ModuleDefinition[] = [],
  opts: { clock?: Clock } = {},
): Promise<TestApp> {
  const config = loadConfig();
  const modules = [...createModules(), ...extraModules];
  const container = await buildContainer(config, modules, { role: 'api', awaitInlineJobs: true, clock: opts.clock });
  const { app } = createHttpApp(container, modules);
  const owner = new OwnerDb(process.env.DATABASE_OWNER_URL!);
  return {
    app,
    container,
    modules,
    owner,
    async close() {
      (container.resolve('cache') as MemoryCache).clear?.();
      await owner.close();
      await disposeContainer(container);
    },
  };
}

/**
 * Fixture writer connected as the schema owner. FORCE ROW LEVEL SECURITY applies to the owner too,
 * so every statement runs in a transaction with an org-wide context.
 */
export class OwnerDb {
  private readonly pool: pg.Pool;
  readonly runId = randomUUID().slice(0, 8);
  private readonly users: string[] = [];

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 2 });
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const org = await client.query<{ id: string }>(`SELECT id FROM core.organisation WHERE code = $1`, [
        process.env.ORG_CODE,
      ]);
      await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.campus_ids', '*', true)`, [
        org.rows[0]!.id,
      ]);
      const r = await client.query<T>(text, params);
      await client.query('COMMIT');
      return r.rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async orgId(): Promise<string> {
    const [row] = await this.query<{ id: string }>(`SELECT id FROM core.organisation WHERE code = $1`, [
      process.env.ORG_CODE,
    ]);
    return row!.id;
  }

  async campusId(code: string): Promise<string> {
    const [row] = await this.query<{ id: string }>(`SELECT id FROM core.campus WHERE code = $1`, [code]);
    return row!.id;
  }

  /** Creates an active staff user with a password and one role (org-wide or campus). */
  async createStaffUser(o: {
    password: string;
    roleCode: string;
    campusCode?: string;
    mfaSecretEnc?: Buffer;
  }): Promise<{ id: string; username: string }> {
    const username = `t.${o.roleCode.toLowerCase()}.${this.runId}.${this.users.length}`;
    const hash = await new PasswordHasher().hash(o.password);
    const orgId = await this.orgId();
    const [user] = await this.query<{ id: string }>(
      `INSERT INTO iam.user_account (org_id, user_type, username, email, password_hash, status, mfa_type, mfa_secret_enc)
       VALUES ($1, 'staff', $2, $3, $4, 'active', $5, $6) RETURNING id`,
      [orgId, username, `${username}@test.local`, hash, o.mfaSecretEnc ? 'totp' : null, o.mfaSecretEnc ?? null],
    );
    const campusId = o.campusCode ? await this.campusId(o.campusCode) : null;
    await this.query(
      `INSERT INTO iam.role_assignment (org_id, user_id, role_id, scope_type, campus_id)
       SELECT $1, $2, r.id, $3, $4 FROM iam.role r WHERE r.org_id = $1 AND r.code = $5`,
      [orgId, user!.id, campusId ? 'campus' : 'org', campusId, o.roleCode],
    );
    this.users.push(user!.id);
    return { id: user!.id, username };
  }

  async createGuardianUser(phone: string): Promise<{ id: string }> {
    const orgId = await this.orgId();
    const [user] = await this.query<{ id: string }>(
      `INSERT INTO iam.user_account (org_id, user_type, phone, status, preferred_locale) VALUES ($1, 'guardian', $2, 'active', 'en') RETURNING id`,
      [orgId, phone],
    );
    await this.query(
      `INSERT INTO iam.role_assignment (org_id, user_id, role_id, scope_type)
       SELECT $1, $2, r.id, 'org' FROM iam.role r WHERE r.org_id = $1 AND r.code = 'PARENT'`,
      [orgId, user!.id],
    );
    this.users.push(user!.id);
    return { id: user!.id };
  }

  async close(): Promise<void> {
    if (this.users.length) {
      await this.query(`DELETE FROM iam.refresh_token WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM iam.otp_challenge WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM iam.role_assignment WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM com.notification_preference WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM com.push_device WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM sys.idempotency_key WHERE user_id = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM sys.stored_file WHERE uploaded_by = ANY($1::uuid[])`, [this.users]);
      await this.query(`DELETE FROM iam.user_account WHERE id = ANY($1::uuid[])`, [this.users]);
    }
    await this.pool.end();
  }
}

/** Extracts cookies from a supertest response into a Cookie header + map. */
export function cookiesFrom(setCookie: string[] | string | undefined): { header: string; map: Record<string, string> } {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const map: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const idx = pair!.indexOf('=');
    const value = pair!.slice(idx + 1);
    if (value) map[pair!.slice(0, idx)] = decodeURIComponent(value);
  }
  return {
    header: Object.entries(map)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
    map,
  };
}
