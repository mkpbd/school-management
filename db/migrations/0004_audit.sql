-- 0004_audit: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE audit.audit_event (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  org_id        uuid,
  campus_id     uuid,
  actor_user_id uuid,
  request_id    text,
  ip            inet,
  source        text NOT NULL CHECK (source IN ('trigger','app')),
  action        text NOT NULL,                     -- INSERT/UPDATE/DELETE | LOGIN, LOGIN_FAILED, EXPORT, BREAK_GLASS, ...
  schema_name   text,
  table_name    text,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  changed_cols  text[],
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);                -- monthly partitions via pg_partman, retention >= 7 years
CREATE INDEX ix_audit_entity ON audit.audit_event (table_name, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_actor  ON audit.audit_event (actor_user_id, occurred_at DESC);

CREATE FUNCTION audit.tg_row_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_changed text[];
  v_schema  text := TG_TABLE_SCHEMA;
  v_table   text := TG_TABLE_NAME;
BEGIN
  -- Row triggers on partitioned tables fire on the partition: record the logical (root) table name instead.
  IF v_table ~ '_(default|p[0-9_]+)$' THEN
    SELECT n.nspname, c.relname INTO v_schema, v_table
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.oid = coalesce(pg_partition_root(TG_RELID), TG_RELID);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.value IS DISTINCT FROM v_old -> n.key
       AND n.key NOT IN ('updated_at','updated_by','row_version');
    IF v_changed IS NULL THEN RETURN NULL; END IF;
  END IF;
  v_old := v_old - TG_ARGV;   -- redact encrypted columns passed as trigger args
  v_new := v_new - TG_ARGV;
  INSERT INTO audit.audit_event (org_id, campus_id, actor_user_id, request_id, ip, source, action,
                                 schema_name, table_name, entity_id, before, after, changed_cols)
  VALUES (coalesce(v_new->>'org_id',    v_old->>'org_id')::uuid,
          coalesce(v_new->>'campus_id', v_old->>'campus_id')::uuid,
          nullif(current_setting('app.user_id', true), '')::uuid,
          current_setting('app.request_id', true),
          nullif(current_setting('app.client_ip', true), '')::inet,
          'trigger', TG_OP, v_schema, v_table,
          -- composite-key tables (attendance, balances) fall back to the person they belong to
          coalesce(v_new->>'id', v_old->>'id', v_new->>'student_id', v_old->>'student_id',
                   v_new->>'staff_id', v_old->>'staff_id'),
          v_old, v_new, v_changed);
  RETURN NULL;
END $$;

CREATE TABLE audit.audit_seal (                    -- hash chain over batches => tamper evidence
  seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_event_id  bigint NOT NULL,
  to_event_id    bigint NOT NULL,
  event_count    integer NOT NULL,
  batch_hash     bytea NOT NULL,                   -- sha256(prev_hash || sha256(canonical rows ordered by id))
  prev_hash      bytea,
  sealed_at      timestamptz NOT NULL DEFAULT now()
);
-- Sealer job (every minute) seals events with occurred_at < now() - interval '2 minutes' (covers in-flight tx).
-- A verifier job recomputes the chain nightly and alerts on mismatch.

REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_event, audit.audit_seal FROM sms_app, sms_worker;
