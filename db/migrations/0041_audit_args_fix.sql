-- 0041_audit_args_fix: audit rows of tables without redacted columns were empty.
-- Run as sms_owner.
--
-- tg_row_audit removed redacted columns with `v_new - TG_ARGV`. A trigger created without arguments has TG_ARGV = NULL,
-- and `jsonb - NULL` is NULL, so before / after, entity_id, org_id and campus_id were lost for every audited table
-- except the few with redaction arguments (user_account, staff, student). Rows written before this fix cannot be
-- recovered; the action, table, actor and time were still recorded.

CREATE OR REPLACE FUNCTION audit.tg_row_audit() RETURNS trigger
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
  IF TG_NARGS > 0 THEN        -- redact encrypted columns passed as trigger args (TG_ARGV is NULL without args)
    v_old := v_old - TG_ARGV;
    v_new := v_new - TG_ARGV;
  END IF;
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
