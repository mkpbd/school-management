import { defineConfig } from 'drizzle-kit';

/**
 * SQL migrations in ../db/migrations are the source of truth (RLS, triggers, partitions, exclusion constraints).
 * Drizzle is the type-safe query layer only:
 *   - `npm run db:schema` regenerates src/shared/infrastructure/db/schema/ from a migrated database
 *     (scripts/gen-db-schema.ts), so TypeScript types always match the real schema.
 *   - `npm run db:studio` browses data with drizzle-kit studio.
 * Never run `drizzle-kit push` / `generate` / `migrate` against shared databases.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/db/schema/*.ts',
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? 'postgres://sms_owner@localhost:5432/school_platform_dev',
  },
  strict: true,
});
