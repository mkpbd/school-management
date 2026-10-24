-- 0000_bootstrap: run ONCE by a superuser/DBA before any other migration.
--   psql -U postgres -v db=school_platform -f 0000_bootstrap.sql
-- Creates the database roles and installs extensions that are not "trusted" (need superuser).
-- Passwords are set out-of-band (vault / ALTER ROLE ... PASSWORD), never in this file.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_owner') THEN
    CREATE ROLE sms_owner LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;          -- owns schemas, runs migrations
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_app') THEN
    CREATE ROLE sms_app LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;            -- API service
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_worker') THEN
    CREATE ROLE sms_worker LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;         -- background workers
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_readonly') THEN
    CREATE ROLE sms_readonly LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;       -- BI / report builder (replica)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_audit_sealer') THEN
    CREATE ROLE sms_audit_sealer LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;   -- audit hash-chain job
  END IF;
END $$;

SELECT format('CREATE DATABASE %I OWNER sms_owner ENCODING ''UTF8'' LOCALE_PROVIDER icu ICU_LOCALE ''en-US'' LOCALE ''C'' TEMPLATE template0',
              :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

\connect :db

-- Untrusted extensions (superuser only). citext, pg_trgm, btree_gist, pgcrypto are trusted and
-- are installed by sms_owner in 0001_foundation.sql.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- Optional (production): partition maintenance. Migrations work without it (see 0031_partitions.sql).
-- CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO sms_app, sms_worker, sms_readonly, sms_audit_sealer;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
