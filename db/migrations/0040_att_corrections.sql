-- 0040_att_corrections: attendance corrections after the edit window (maker-checker) and the audited mark history.
-- Run as sms_owner.

CREATE TABLE att.attendance_correction (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id               uuid NOT NULL,
  campus_id            uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('daily','period')),
  student_id           uuid NOT NULL REFERENCES sis.student(id),
  attendance_date      date NOT NULL,
  class_section_id     uuid REFERENCES aca.class_section(id),         -- daily
  teaching_group_id    uuid REFERENCES aca.teaching_group(id),        -- period
  period_definition_id uuid REFERENCES aca.period_definition(id),     -- period
  old_status           text,                                          -- NULL = never marked
  new_status           text NOT NULL,
  reason               text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by         uuid NOT NULL,
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK ((kind = 'daily') = (period_definition_id IS NULL)),
  CHECK (kind = 'daily' OR teaching_group_id IS NOT NULL),
  CHECK (new_status IN ('present','absent','late','leave','half_day','excused')),
  CHECK (kind = 'daily' OR new_status IN ('present','absent','late','excused')),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),          -- maker-checker
  CHECK ((status IN ('approved','rejected')) = (decided_by IS NOT NULL))
);
-- one open request per mark
CREATE UNIQUE INDEX ux_att_correction_pending ON att.attendance_correction (student_id, attendance_date, period_definition_id)
  NULLS NOT DISTINCT WHERE status = 'pending';
CREATE INDEX ix_att_correction_queue ON att.attendance_correction (campus_id, status, attendance_date);

CALL core.enable_touch('att.attendance_correction');
CALL core.enable_campus_rls('att.attendance_correction');
CALL core.enable_audit('att.attendance_correction');

COMMENT ON TABLE att.attendance_correction IS
  'Change to a daily or period mark after the edit window; applied only when another user approves. [ATT-01 edit window with audit]';

-- The app role cannot read audit.audit_event. This narrow reader returns the audited changes of one student's
-- attendance marks on one date, limited to campuses visible to the caller (same predicate as RLS).
CREATE FUNCTION att.mark_history(p_student uuid, p_date date)
RETURNS TABLE (occurred_at timestamptz, actor_user_id uuid, table_name text, action text,
               before jsonb, after jsonb, changed_cols text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.occurred_at, e.actor_user_id, e.table_name, e.action,
         e.before - ARRAY['org_id','campus_id'], e.after - ARRAY['org_id','campus_id'], e.changed_cols
    FROM audit.audit_event e
   WHERE e.schema_name = 'att'
     AND e.table_name IN ('student_daily_attendance', 'period_attendance')
     AND e.entity_id = p_student::text
     AND coalesce(e.after ->> 'attendance_date', e.before ->> 'attendance_date') = p_date::text
     AND core.campus_visible(e.org_id, e.campus_id)
   ORDER BY e.occurred_at, e.id
$$;
REVOKE ALL ON FUNCTION att.mark_history(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION att.mark_history(uuid, date) TO sms_app;
