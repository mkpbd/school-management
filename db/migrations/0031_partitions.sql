-- 0031_partitions: partition maintenance without requiring pg_partman.
-- core.ensure_partitions() is idempotent; the worker's nightly 'maintenance' job calls it to stay N periods ahead.
-- (If pg_partman is installed, it can take over: partman.create_parent(...) on the same parents.)

CREATE FUNCTION core.ensure_partitions(p_parent regclass, p_grain text, p_from date, p_ahead integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_step  interval := CASE p_grain WHEN 'year' THEN interval '1 year'
                                   WHEN 'month' THEN interval '1 month'
                                   WHEN 'day' THEN interval '1 day' END;
  v_start date := date_trunc(p_grain, p_from)::date;
  v_end   date;
  v_name  text;
  v_fmt   text := CASE p_grain WHEN 'year' THEN 'YYYY' WHEN 'month' THEN 'YYYY_MM' ELSE 'YYYY_MM_DD' END;
  v_made  integer := 0;
  v_schema text; v_table text;
BEGIN
  IF v_step IS NULL THEN RAISE EXCEPTION 'grain must be year|month|day'; END IF;
  SELECT n.nspname, c.relname INTO v_schema, v_table
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p_parent;

  -- safety net: rows outside every range land here instead of failing the business transaction
  IF NOT EXISTS (SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
                  WHERE i.inhparent = p_parent AND c.relname = v_table || '_default') THEN
    EXECUTE format('CREATE TABLE %I.%I PARTITION OF %s DEFAULT', v_schema, v_table || '_default', p_parent);
  END IF;

  FOR i IN 0 .. p_ahead LOOP
    v_end  := (v_start + v_step)::date;
    v_name := v_table || '_p' || to_char(v_start, v_fmt);
    IF to_regclass(format('%I.%I', v_schema, v_name)) IS NULL THEN
      EXECUTE format('CREATE TABLE %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                     v_schema, v_name, p_parent, v_start, v_end);
      v_made := v_made + 1;
    END IF;
    v_start := v_end;
  END LOOP;
  RETURN v_made;
END $$;
COMMENT ON FUNCTION core.ensure_partitions IS
  'Creates DEFAULT partition + range partitions from p_from for p_ahead periods (idempotent). Called by nightly maintenance.';

-- Initial partitions: academic years 2025-26 onwards / current months.
DO $$
BEGIN
  PERFORM core.ensure_partitions('att.student_daily_attendance', 'year',  date '2025-01-01', 3);
  PERFORM core.ensure_partitions('att.period_attendance',        'year',  date '2025-01-01', 3);
  PERFORM core.ensure_partitions('att.staff_attendance',         'year',  date '2025-01-01', 3);
  PERFORM core.ensure_partitions('att.device_event',             'month', date '2026-07-01', 12);
  PERFORM core.ensure_partitions('sec.gate_event',               'month', date '2026-07-01', 12);
  PERFORM core.ensure_partitions('com.outbound_message',         'month', date '2026-07-01', 12);
  PERFORM core.ensure_partitions('audit.audit_event',            'month', date '2026-07-01', 12);
  PERFORM core.ensure_partitions('trn.gps_ping',                 'day',   current_date,      14);
END $$;
