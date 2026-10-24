-- 0037_hst: hostel / boarding management (HST)
--   hostels -> rooms -> beds; student bed allocations (no double booking, one hostel at a time);
--   morning / night roll call; out-passes with gate check-out / check-in; visitor log.
-- This schema is created after 0030_standardize / 0032_grants, so grants, RLS and touch triggers are set here.

CREATE SCHEMA hst;
COMMENT ON SCHEMA hst IS 'HST: hostels, rooms, beds, allocations, roll call, out-passes, visitors';
GRANT USAGE ON SCHEMA hst TO sms_app, sms_worker, sms_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA hst GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sms_app, sms_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA hst GRANT SELECT ON TABLES TO sms_readonly;

CREATE TABLE hst.hostel (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL REFERENCES core.campus(id),
  code            text NOT NULL,
  name            text NOT NULL,
  gender          text NOT NULL CHECK (gender IN ('boys','girls','mixed')),
  warden_staff_id uuid REFERENCES hrm.staff(id),
  address         text,
  phone           core.phone_e164,
  is_active       boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (campus_id, code)
);

CREATE TABLE hst.room (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  hostel_id         uuid NOT NULL REFERENCES hst.hostel(id),
  code              text NOT NULL,                -- '2-07'
  floor             smallint NOT NULL DEFAULT 0,
  room_type         text NOT NULL CHECK (room_type IN ('single','double','triple','quad','dormitory')),
  monthly_fee_paisa core.paisa_nn NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (hostel_id, code)
);

CREATE TABLE hst.bed (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  campus_id  uuid NOT NULL,
  room_id    uuid NOT NULL REFERENCES hst.room(id),
  code       text NOT NULL,                       -- 'A', 'B', ...
  is_active  boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (room_id, code)
);

CREATE TABLE hst.allocation (                      -- a student on a bed for a period
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  hostel_id         uuid NOT NULL REFERENCES hst.hostel(id),
  bed_id            uuid NOT NULL REFERENCES hst.bed(id),
  student_id        uuid NOT NULL REFERENCES sis.student(id),
  enrolment_id      uuid NOT NULL REFERENCES sis.enrolment(id),
  valid_from        date NOT NULL,
  valid_to          date,
  meal_plan         text NOT NULL DEFAULT 'full' CHECK (meal_plan IN ('full','none')),
  monthly_fee_paisa core.paisa_nn NOT NULL DEFAULT 0,
  meal_fee_paisa    core.paisa_nn NOT NULL DEFAULT 0,
  end_reason        text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- one bed per student at a time, one student per bed at a time
  EXCLUDE USING gist (student_id WITH =, daterange(valid_from, coalesce(valid_to, 'infinity'), '[]') WITH &&),
  EXCLUDE USING gist (bed_id WITH =, daterange(valid_from, coalesce(valid_to, 'infinity'), '[]') WITH &&)
);
CREATE INDEX ix_hst_allocation_hostel ON hst.allocation (hostel_id) WHERE valid_to IS NULL;

CREATE TABLE hst.roll_call (
  org_id     uuid NOT NULL,
  campus_id  uuid NOT NULL,
  hostel_id  uuid NOT NULL REFERENCES hst.hostel(id),
  roll_date  date NOT NULL,
  session    text NOT NULL CHECK (session IN ('morning','night')),
  student_id uuid NOT NULL,
  status     text NOT NULL CHECK (status IN ('present','absent','late','on_leave')),
  note       text,
  marked_by  uuid,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, roll_date, session)
);
CREATE INDEX ix_hst_roll_call_hostel ON hst.roll_call (hostel_id, roll_date, session);

CREATE TABLE hst.outpass (                         -- permission to leave the hostel
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL,
  hostel_id           uuid NOT NULL REFERENCES hst.hostel(id),
  student_id          uuid NOT NULL REFERENCES sis.student(id),
  kind                text NOT NULL CHECK (kind IN ('day_out','home_leave','medical','other')),
  destination         text NOT NULL,
  reason              text,
  escort_name         text,
  escort_phone        core.phone_e164,
  out_from            timestamptz NOT NULL,
  return_by           timestamptz NOT NULL,
  requested_by        uuid,
  requested_by_type   text NOT NULL CHECK (requested_by_type IN ('guardian','staff')),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','cancelled','out','returned')),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  checked_out_at      timestamptz,
  checked_out_by      uuid,
  checked_in_at       timestamptz,
  checked_in_by       uuid,
  overdue_notified_at timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (return_by > out_from)
);
CREATE INDEX ix_hst_outpass_student ON hst.outpass (student_id, out_from DESC);
CREATE INDEX ix_hst_outpass_out ON hst.outpass (return_by) WHERE status = 'out';

CREATE TABLE hst.visitor_log (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  hostel_id    uuid NOT NULL REFERENCES hst.hostel(id),
  student_id   uuid NOT NULL REFERENCES sis.student(id),
  visitor_name text NOT NULL,
  relation     text NOT NULL,
  phone        core.phone_e164,
  id_doc_no    text,
  purpose      text,
  in_at        timestamptz NOT NULL,
  out_at       timestamptz,
  recorded_by  uuid,
  CHECK (out_at IS NULL OR out_at >= in_at)
);
CREATE INDEX ix_hst_visitor_hostel ON hst.visitor_log (hostel_id, in_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hst TO sms_app, sms_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA hst TO sms_readonly;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hst.hostel','hst.room','hst.bed','hst.allocation','hst.outpass'] LOOP
    CALL core.enable_touch(t::regclass);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['hst.hostel','hst.room','hst.bed','hst.allocation','hst.roll_call','hst.outpass','hst.visitor_log'] LOOP
    CALL core.enable_campus_rls(t::regclass);
  END LOOP;
  CALL core.enable_audit('hst.allocation'::regclass);
  CALL core.enable_audit('hst.outpass'::regclass);
END $$;

COMMENT ON TABLE hst.hostel IS 'Hostel building of a campus (boys / girls / mixed) with its warden. [HST]';
COMMENT ON TABLE hst.room IS 'Hostel room with type and monthly rent. [HST]';
COMMENT ON TABLE hst.bed IS 'Bed in a room; the unit of allocation. [HST]';
COMMENT ON TABLE hst.allocation IS 'Student on a bed for a period; never two beds or two students at once. [HST]';
COMMENT ON TABLE hst.roll_call IS 'Morning / night roll call per resident. [HST]';
COMMENT ON TABLE hst.outpass IS 'Out-pass: request, approval, gate check-out / check-in, overdue alert. [HST]';
COMMENT ON TABLE hst.visitor_log IS 'Visitors of residents with in / out time. [HST]';
