-- 0033_fk_indexes: PostgreSQL does not index foreign-key columns automatically.
-- Index every FK whose columns are not already the leading columns of an index, so joins, RLS campus filters and
-- parent-row deletes/updates stay fast. FKs to core.organisation, sys.stored_file and wf.approval_request are skipped:
-- those parents are effectively never deleted and the columns are not join paths in hot queries.
-- Re-runnable: only missing indexes are created.

DO $$
DECLARE
  r record;
  v_name text;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, t.relname,
           array_agg(a.attname ORDER BY k.ord) AS cols
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND NOT t.relispartition AND c.conparentid = 0
       AND c.confrelid::regclass::text NOT IN ('core.organisation', 'sys.stored_file', 'wf.approval_request')
       AND NOT EXISTS (SELECT 1 FROM pg_index i
                        WHERE i.indrelid = c.conrelid
                          AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
     GROUP BY c.oid, c.conrelid, t.relname
  LOOP
    v_name := left('ix_' || r.relname || '_' || array_to_string(r.cols, '_'), 60) || '_fk';
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', v_name, r.tbl,
                   (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.cols) x));
  END LOOP;
END $$;
