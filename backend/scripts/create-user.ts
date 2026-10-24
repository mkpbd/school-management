/**
 * Creates (or resets) a staff login with one role — for first setup and development.
 *   npm run user:create -- --username admin --password 'S3cure-Pass!' --role IT_ADMIN [--campus DHN] [--email a@b.c]
 * Runs as the schema owner (DATABASE_OWNER_URL). Role codes: see db/seeds/0002 (PRINCIPAL, CAMPUS_HEAD, ACCOUNTANT, ...).
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { PasswordHasher, passwordPolicyErrors } from '../src/shared/infrastructure/crypto/PasswordHasher.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string', default: 'IT_ADMIN' },
    campus: { type: 'string' },
    email: { type: 'string' },
  },
});
if (!values.username || !values.password) {
  console.error('usage: npm run user:create -- --username <u> --password <p> [--role CODE] [--campus DHN] [--email x]');
  process.exit(2);
}
const problems = passwordPolicyErrors(values.password);
if (problems.length) {
  console.error(`password: ${problems.join(', ')}`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const org = await client.query<{ id: string }>('SELECT id FROM core.organisation WHERE code = $1', [
    process.env.ORG_CODE ?? 'LIS',
  ]);
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new Error('organisation not found — run db seeds first');
  await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.campus_ids', '*', true)`, [orgId]);

  const role = await client.query<{ id: string; requires_mfa: boolean }>(
    'SELECT id, requires_mfa FROM iam.role WHERE org_id = $1 AND code = $2',
    [orgId, values.role],
  );
  if (!role.rows[0]) throw new Error(`unknown role ${values.role}`);
  const campusId = values.campus
    ? (
        await client.query<{ id: string }>('SELECT id FROM core.campus WHERE org_id = $1 AND code = $2', [
          orgId,
          values.campus,
        ])
      ).rows[0]?.id
    : null;
  if (values.campus && !campusId) throw new Error(`unknown campus ${values.campus}`);

  const hash = await new PasswordHasher().hash(values.password);
  const user = await client.query<{ id: string }>(
    `INSERT INTO iam.user_account (org_id, user_type, username, email, password_hash, status)
     VALUES ($1, 'staff', $2, $3, $4, 'active')
     ON CONFLICT (org_id, username) WHERE username IS NOT NULL AND deleted_at IS NULL
     DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active', failed_login_count = 0, locked_until = NULL,
                   authz_version = iam.user_account.authz_version + 1
     RETURNING id`,
    [orgId, values.username, values.email ?? null, hash],
  );
  const userId = user.rows[0]!.id;
  await client.query(
    `INSERT INTO iam.role_assignment (org_id, user_id, role_id, scope_type, campus_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [orgId, userId, role.rows[0].id, campusId ? 'campus' : 'org', campusId],
  );
  await client.query('COMMIT');
  console.log(
    `user ${values.username} (${userId}) ready with role ${values.role}${campusId ? ` @ ${values.campus}` : ' (all campuses)'}`,
  );
  if (role.rows[0].requires_mfa)
    console.log('note: this role requires MFA; login will report mfaEnrollmentRequired=true');
} catch (err) {
  await client.query('ROLLBACK');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
