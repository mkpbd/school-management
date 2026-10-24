/**
 * Test environment defaults. Integration tests need their own database built with ../db (migrations + seeds), e.g.
 *   DB=school_platform_test bash ../db/tools/rebuild-and-test.sh   (or: npm run db:test-rebuild)
 * It must not be the dev database: a running dev worker drains the shared outbox and races the tests.
 * Override with TEST_DATABASE_URL / TEST_DATABASE_OWNER_URL.
 */
const host = process.env.TEST_PGHOST ?? 'localhost';
const port = process.env.TEST_PGPORT ?? '55432';
const dbName = process.env.TEST_PGDATABASE ?? 'school_platform_test';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? `postgres://sms_app@${host}:${port}/${dbName}`;
process.env.DATABASE_WORKER_URL =
  process.env.TEST_DATABASE_WORKER_URL ?? `postgres://sms_worker@${host}:${port}/${dbName}`;
process.env.DATABASE_OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ?? `postgres://sms_owner@${host}:${port}/${dbName}`;
process.env.COOKIE_SECURE = 'false';
process.env.ORG_CODE ??= 'LIS';
// files go to local disk (no MinIO in CI / dev); the S3 adapter is configured but unused
process.env.STORAGE_DRIVER ??= 'local';
process.env.LOCAL_STORAGE_DIR ??= 'var/test-storage';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_ACCESS_KEY_ID ??= 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.METRICS_TOKEN ??= 'test-metrics-token';
delete process.env.REDIS_URL; // tests use in-memory cache/limits and inline jobs
