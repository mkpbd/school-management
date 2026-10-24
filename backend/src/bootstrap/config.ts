import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());
const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const pem = z.preprocess(
  (v) => (typeof v === 'string' && v !== '' ? v.replace(/\\n/g, '\n') : undefined),
  z.string().optional(),
);

/**
 * Environment configuration, validated at boot (fail fast). docs/backend/cross-cutting.md §2.
 * School-editable settings live in the database (core.setting), not here.
 */
const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
    WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    DATABASE_URL: z.string().url(),
    DATABASE_REPLICA_URL: optionalUrl,
    DATABASE_WORKER_URL: optionalUrl,
    DB_POOL_MAX: z.coerce.number().int().positive().default(20),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    REDIS_URL: optionalUrl,
    ORG_CODE: z.string().min(1).default('LIS'),

    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEYS: pem,
    JWT_KID: z.string().default('dev-1'),
    JWT_ISSUER: z.string().default('school-platform'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS_WEB: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_TTL_DAYS_APP: z.coerce.number().int().positive().default(90),
    COOKIE_SECURE: bool.default(true),

    FIELD_KEY_V1: optional,
    BLIND_INDEX_KEY: optional,

    /** 'local' = files on disk under LOCAL_STORAGE_DIR, served by the API (dev / test); default: s3 in production
     *  or when S3_ENDPOINT is set, else local */
    /** Cloudflare Turnstile for public admission forms (both set = captcha on; otherwise off) */
    TURNSTILE_SITE_KEY: optional,
    TURNSTILE_SECRET: optional,
    /** HMAC key for public form tokens (base64); default: derived from BLIND_INDEX_KEY */
    FORM_TOKEN_SECRET: optional,
    STORAGE_DRIVER: z.enum(['s3', 'local']).optional(),
    LOCAL_STORAGE_DIR: z.string().default('var/storage'),
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET_PRIVATE: z.string().default('school-private'),
    S3_BUCKET_PUBLIC: z.string().default('school-public'),
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_FORCE_PATH_STYLE: bool.default(true),

    CLAMAV_HOST: optional,
    SMS_PROVIDER: z.enum(['console']).default('console'),
    /** e-mail over SMTP (smtp(s)://user:pass@host:port); console provider when unset */
    SMTP_URL: optional,
    MAIL_FROM: z.string().default('School <no-reply@school.local>'),
    /** Firebase Cloud Messaging service account; console push provider when unset */
    FCM_PROJECT_ID: optional,
    FCM_CLIENT_EMAIL: optional,
    FCM_PRIVATE_KEY: optional,
    METRICS_TOKEN: optional,
    /** Swagger UI at /api/docs; default on outside production */
    SWAGGER_ENABLED: bool.optional(),
    FEATURE_FLAGS: z
      .string()
      .default('{}')
      .transform((s, ctx) => {
        try {
          return JSON.parse(s) as Record<string, boolean>;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'FEATURE_FLAGS must be JSON' });
          return z.NEVER;
        }
      }),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production') {
      for (const key of [
        'JWT_PRIVATE_KEY',
        'JWT_PUBLIC_KEYS',
        'FIELD_KEY_V1',
        'BLIND_INDEX_KEY',
        'REDIS_URL',
      ] as const) {
        if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
      }
      if (c.STORAGE_DRIVER === 'local')
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'local file storage is for development only',
        });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  return parsed.data;
}
