-- 0001_foundation: schemas, trusted extensions, collations, domains and shared helper functions.
-- Run as sms_owner (database owner).

CREATE SCHEMA core;   COMMENT ON SCHEMA core   IS 'CORE: organisation, campuses, academic calendar, settings, numbering';
CREATE SCHEMA iam;    COMMENT ON SCHEMA iam    IS 'CORE: identity & access (users, roles, permissions, sessions, consent)';
CREATE SCHEMA audit;  COMMENT ON SCHEMA audit  IS 'CORE: append-only, hash-sealed audit trail';
CREATE SCHEMA wf;     COMMENT ON SCHEMA wf     IS 'CORE: configurable multi-step approval workflows';
CREATE SCHEMA IF NOT EXISTS sys; COMMENT ON SCHEMA sys    IS 'Platform plumbing: outbox, idempotency, files, imports, jobs';
CREATE SCHEMA search; COMMENT ON SCHEMA search IS 'CORE: global search read model fed by domain events';
CREATE SCHEMA sis;    COMMENT ON SCHEMA sis    IS 'SIS: students, guardians, families, enrolment history';
CREATE SCHEMA adm;    COMMENT ON SCHEMA adm    IS 'ADM: enquiry, application, tests, merit list, offers';
CREATE SCHEMA aca;    COMMENT ON SCHEMA aca    IS 'ACA: programmes, classes, subjects, teaching groups, timetable';
CREATE SCHEMA att;    COMMENT ON SCHEMA att    IS 'ATT: student & staff attendance, devices, leave';
CREATE SCHEMA lrn;    COMMENT ON SCHEMA lrn    IS 'LRN: homework, diary, resources, gradebook, quizzes';
CREATE SCHEMA exm;    COMMENT ON SCHEMA exm    IS 'EXM: exams, marks, grading, results, report cards, Edexcel';
CREATE SCHEMA fee;    COMMENT ON SCHEMA fee    IS 'FEE: fee structures, invoices, payments, gateways, reconciliation';
CREATE SCHEMA acc;    COMMENT ON SCHEMA acc    IS 'ACC: chart of accounts, journals, budgets, procurement';
CREATE SCHEMA hrm;    COMMENT ON SCHEMA hrm    IS 'HRM: staff, contracts, payroll, recruitment, appraisal';
CREATE SCHEMA com;    COMMENT ON SCHEMA com    IS 'COM: notices, templates, notification hub, messaging';
CREATE SCHEMA prt;    COMMENT ON SCHEMA prt    IS 'PRT: online forms and consents for portals';
CREATE SCHEMA doc;    COMMENT ON SCHEMA doc    IS 'DOC: certificate/letter templates and issue register';
CREATE SCHEMA web;    COMMENT ON SCHEMA web    IS 'WEB: public website CMS data and API clients';
CREATE SCHEMA bi;     COMMENT ON SCHEMA bi     IS 'BI: pre-aggregated KPI tables and saved reports';
CREATE SCHEMA trn;    COMMENT ON SCHEMA trn    IS 'TRN: vehicles, routes, stops, transport assignment, GPS';
CREATE SCHEMA lib;    COMMENT ON SCHEMA lib    IS 'LIB: catalogue, copies, circulation, reservations';
CREATE SCHEMA inv;    COMMENT ON SCHEMA inv    IS 'INV: items, stores, stock ledger, POS, assets, maintenance';
CREATE SCHEMA hlt;    COMMENT ON SCHEMA hlt    IS 'HLT: health, sick bay, behaviour, counselling, safeguarding';
CREATE SCHEMA cca;    COMMENT ON SCHEMA cca    IS 'CCA: houses, clubs, events, awards, Islamic values programme';
CREATE SCHEMA sec;    COMMENT ON SCHEMA sec    IS 'SEC: visitors, safe pick-up, gate events, drills';

CREATE EXTENSION IF NOT EXISTS citext     SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm    SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;   -- exclusion constraints on (uuid, range)
CREATE EXTENSION IF NOT EXISTS pgcrypto   SCHEMA public;   -- digest() for audit seals

CREATE COLLATION core.bn_bd      (provider = icu, locale = 'bn-BD');
CREATE COLLATION core.en_natural (provider = icu, locale = 'en-u-kn');   -- numeric-aware: 'Year 2' < 'Year 10'

CREATE DOMAIN core.paisa       AS bigint;                                   -- money in paisa, signed (adjustments)
CREATE DOMAIN core.paisa_nn    AS bigint        CHECK (VALUE >= 0);         -- money in paisa, non-negative
CREATE DOMAIN core.percent     AS numeric(5,2)  CHECK (VALUE BETWEEN 0 AND 100);
CREATE DOMAIN core.locale      AS text          CHECK (VALUE IN ('en','bn'));
CREATE DOMAIN core.phone_e164  AS text          CHECK (VALUE ~ '^\+[1-9][0-9]{7,14}$');

COMMENT ON DOMAIN core.paisa IS 'Money as integer paisa (1 BDT = 100 paisa). Never floating point.';

-- ---------------------------------------------------------------------------------------------
-- Request context (set per transaction by the API with set_config(..., true))
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION core.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION core.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

-- Campus row-level security predicate. CASE guarantees evaluation order (OR does not short-circuit).
CREATE FUNCTION core.campus_visible(p_org uuid, p_campus uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p_org = core.current_org_id()
     AND CASE
           WHEN current_setting('app.campus_ids', true) = '*' THEN true
           WHEN p_campus IS NULL THEN true                                   -- org-wide rows
           ELSE p_campus = ANY (string_to_array(current_setting('app.campus_ids', true), ',')::uuid[])
         END;
$$;

-- Org-only predicate for tables without campus_id (master data shared by all campuses).
CREATE FUNCTION core.org_visible(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT p_org = core.current_org_id() $$;

-- ---------------------------------------------------------------------------------------------
-- Standard columns template:  CREATE TABLE x (..., LIKE core.std_cols INCLUDING DEFAULTS)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE core.std_cols (
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid                 DEFAULT core.current_user_id(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  row_version integer     NOT NULL DEFAULT 1
);
COMMENT ON TABLE core.std_cols IS 'Template only (no rows): standard audit + optimistic-concurrency columns';
REVOKE ALL ON core.std_cols FROM PUBLIC;

CREATE FUNCTION core.tg_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at  := now();
  NEW.updated_by  := core.current_user_id();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Helpers used by 0030_standardize.sql
-- ---------------------------------------------------------------------------------------------
CREATE PROCEDURE core.enable_touch(p_table regclass)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE OR REPLACE TRIGGER trg_touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION core.tg_touch()', p_table);
END $$;

CREATE PROCEDURE core.enable_audit(p_table regclass, p_redact text[] DEFAULT '{}',
                                   p_events text DEFAULT 'INSERT OR UPDATE OR DELETE')
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE OR REPLACE TRIGGER trg_audit AFTER %s ON %s FOR EACH ROW EXECUTE FUNCTION audit.tg_row_audit(%s)',
                 p_events, p_table,
                 array_to_string(array(SELECT quote_literal(x) FROM unnest(p_redact) x), ','));
END $$;

CREATE PROCEDURE core.enable_campus_rls(p_table regclass)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = p_table AND polname = 'p_campus') THEN RETURN; END IF;
  EXECUTE format('CREATE POLICY p_campus ON %s USING (core.campus_visible(org_id, campus_id))
                  WITH CHECK (core.campus_visible(org_id, campus_id))', p_table);
END $$;

CREATE PROCEDURE core.enable_org_rls(p_table regclass)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = p_table AND polname = 'p_org') THEN RETURN; END IF;
  EXECUTE format('CREATE POLICY p_org ON %s USING (core.org_visible(org_id)) WITH CHECK (core.org_visible(org_id))', p_table);
END $$;
