-- 0039_hrm_cpd: continuing professional development (HRM-06) on top of 0018_hrm_p2
--   catalogue (cpd_course) -> sessions with registration and attendance -> records (hours, certificate number);
--   external training logged by the teacher and verified by HR. Records get tenant columns and RLS.

ALTER TABLE hrm.cpd_course
  ADD COLUMN category    text NOT NULL DEFAULT 'pedagogy'
                         CHECK (category IN ('pedagogy','subject','safeguarding','leadership','technology','curriculum','wellbeing','other')),
  ADD COLUMN delivery    text NOT NULL DEFAULT 'in_person' CHECK (delivery IN ('in_person','online','blended')),
  ADD COLUMN description text;

CREATE TABLE hrm.cpd_session (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL REFERENCES core.campus(id),
  course_id   uuid NOT NULL REFERENCES hrm.cpd_course(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  venue       text,
  trainer     text,
  capacity    smallint NOT NULL DEFAULT 30 CHECK (capacity > 0),
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ix_cpd_session_time ON hrm.cpd_session (campus_id, starts_at);

ALTER TABLE hrm.cpd_record
  ADD COLUMN org_id          uuid,
  ADD COLUMN source          text NOT NULL DEFAULT 'external' CHECK (source IN ('session','external')),
  ADD COLUMN session_id      uuid REFERENCES hrm.cpd_session(id),
  ADD COLUMN provider        text,
  ADD COLUMN certificate_no  text,
  ADD COLUMN verified_by     uuid,
  ADD COLUMN verified_at     timestamptz,
  ADD COLUMN created_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by      uuid DEFAULT core.current_user_id();
UPDATE hrm.cpd_record r SET org_id = s.org_id FROM hrm.staff s WHERE s.id = r.staff_id;
ALTER TABLE hrm.cpd_record ALTER COLUMN org_id SET NOT NULL;
CREATE UNIQUE INDEX ux_cpd_record_session ON hrm.cpd_record (session_id, staff_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX ux_cpd_certificate_no ON hrm.cpd_record (org_id, certificate_no) WHERE certificate_no IS NOT NULL;
CREATE INDEX ix_cpd_record_staff ON hrm.cpd_record (staff_id, completed_on);

CREATE TABLE hrm.cpd_attendance (
  session_id    uuid NOT NULL REFERENCES hrm.cpd_session(id) ON DELETE CASCADE,
  staff_id      uuid NOT NULL REFERENCES hrm.staff(id),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  status        text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','attended','absent','cancelled')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  marked_at     timestamptz,
  PRIMARY KEY (session_id, staff_id)
);

CALL core.enable_touch('hrm.cpd_session');
CALL core.enable_campus_rls('hrm.cpd_session');
CALL core.enable_campus_rls('hrm.cpd_attendance');
CALL core.enable_org_rls('hrm.cpd_record');

COMMENT ON TABLE hrm.cpd_session IS 'A scheduled run of a CPD course with capacity. [HRM-06]';
COMMENT ON TABLE hrm.cpd_attendance IS 'Registration and attendance of staff at a CPD session. [HRM-06]';
COMMENT ON COLUMN hrm.cpd_record.verified_at IS 'Session records are verified on completion; external ones by HR';
