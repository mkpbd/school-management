-- 0010_att: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE att.student_daily_attendance (        -- ATT-01, ~660k rows/yr; yearly partitions
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  attendance_date  date NOT NULL,
  student_id       uuid NOT NULL,
  enrolment_id     uuid NOT NULL,
  class_section_id uuid NOT NULL,
  status           text NOT NULL CHECK (status IN ('present','absent','late','leave','half_day','excused','holiday')),
  arrived_at       timestamptz,
  departed_at      timestamptz,
  source           text NOT NULL CHECK (source IN ('teacher','device','import','leave_auto','correction')),
  leave_request_id uuid,
  remarks          text,
  marked_by        uuid,
  marked_at        timestamptz NOT NULL DEFAULT now(),
  row_version      integer NOT NULL DEFAULT 1,
  PRIMARY KEY (student_id, attendance_date)
) PARTITION BY RANGE (attendance_date);
CREATE INDEX ix_sda_section_date ON att.student_daily_attendance (class_section_id, attendance_date);
CREATE INDEX ix_sda_absent ON att.student_daily_attendance (campus_id, attendance_date) WHERE status IN ('absent','late');
-- std(audit on UPDATE/DELETE only, rls). Edit window enforced in domain (e.g. same day; later = correction workflow).

CREATE TABLE att.period_attendance (               -- senior years, per teaching group & period
  org_id               uuid NOT NULL,
  campus_id            uuid NOT NULL,
  attendance_date      date NOT NULL,
  period_definition_id uuid NOT NULL,
  teaching_group_id    uuid NOT NULL,
  student_id           uuid NOT NULL,
  status               text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  source               text NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher','online_join_log','correction')),
  marked_by            uuid,
  marked_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, attendance_date, period_definition_id)
) PARTITION BY RANGE (attendance_date);
CREATE INDEX ix_pa_group_date ON att.period_attendance (teaching_group_id, attendance_date);

CREATE TABLE att.device (                          -- ATT-02 (P2)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  vendor      text NOT NULL CHECK (vendor IN ('zkteco','hikvision','generic_qr','generic_rfid')),
  serial_no   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('biometric','rfid_gate','qr_scanner','bus_reader')),
  location    text,
  direction   text CHECK (direction IN ('in','out','both')),
  secret_hash bytea NOT NULL,                      -- device-bridge HMAC credential
  last_seen_at timestamptz,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, serial_no)
);  -- std(rls)

CREATE TABLE att.device_event (                    -- raw punches, store-and-forward from bridge
  id           bigint GENERATED ALWAYS AS IDENTITY,
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  device_id    uuid NOT NULL,
  event_time   timestamptz NOT NULL,
  credential   text NOT NULL,                      -- card uid / enrolled user pin
  person_type  text CHECK (person_type IN ('student','staff','unknown')),
  person_id    uuid,
  direction    text CHECK (direction IN ('in','out')),
  bridge_seq   bigint NOT NULL,                    -- de-dup key from bridge
  processed_at timestamptz,
  raw          jsonb,
  PRIMARY KEY (id, event_time),
  UNIQUE (device_id, bridge_seq, event_time)
) PARTITION BY RANGE (event_time);
CREATE INDEX ix_device_event_unprocessed ON att.device_event (event_time) WHERE processed_at IS NULL;

CREATE TABLE att.student_leave_request (           -- ATT-04
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  enrolment_id     uuid NOT NULL,
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  reason_code      text NOT NULL,
  reason_note      text,
  attachment_file_id uuid REFERENCES sys.stored_file(id),
  requested_by_user uuid NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approval_request_id uuid,
  decided_by       uuid,
  decided_at       timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (to_date >= from_date)
);  -- std(audit, rls)

CREATE TABLE att.attendance_rule (                 -- ATT-05 thresholds
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  programme_id    uuid REFERENCES aca.programme(id),   -- NULL = all
  min_percent     core.percent NOT NULL,               -- e.g. 80.00 for exam eligibility
  warning_levels  numeric(5,2)[] NOT NULL DEFAULT '{90,85}',
  late_counts_as  numeric(3,2) NOT NULL DEFAULT 1.00,  -- 3 lates = 1 absence => 0.33
  period          text NOT NULL CHECK (period IN ('term','academic_year','exam_window')),
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE att.attendance_flag (                 -- generated warnings / eligibility flags
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  student_id    uuid NOT NULL,
  rule_id       uuid NOT NULL REFERENCES att.attendance_rule(id),
  term_id       uuid,
  percent       core.percent NOT NULL,
  level         text NOT NULL CHECK (level IN ('warning_1','warning_2','ineligible')),
  raised_at     timestamptz NOT NULL DEFAULT now(),
  letter_document_id uuid,
  resolved_at   timestamptz
);  -- std(rls)

-- Staff attendance and leave (ATT-06, ATT-07)
CREATE TABLE att.staff_attendance (
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  attendance_date date NOT NULL,
  staff_id        uuid NOT NULL,
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  status          text NOT NULL CHECK (status IN ('present','absent','late','leave','half_day','holiday','weekly_off','on_duty')),
  late_minutes    smallint NOT NULL DEFAULT 0,
  early_leave_minutes smallint NOT NULL DEFAULT 0,
  overtime_minutes smallint NOT NULL DEFAULT 0,
  source          text NOT NULL CHECK (source IN ('device','mobile_geo','manual','leave_auto')),
  geo_lat         numeric(9,6),
  geo_lng         numeric(9,6),
  PRIMARY KEY (staff_id, attendance_date)
) PARTITION BY RANGE (attendance_date);

CREATE TABLE att.staff_leave_type (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  code              text NOT NULL,                 -- CL, SL, EL, ML, LWP
  name_en           text NOT NULL,
  name_bn           text,
  annual_quota_days numeric(5,1) NOT NULL,
  max_carry_forward numeric(5,1) NOT NULL DEFAULT 0,
  is_paid           boolean NOT NULL DEFAULT true,
  gender_restriction text CHECK (gender_restriction IN ('male','female')),
  requires_document_after_days smallint,
  counts_holidays   boolean NOT NULL DEFAULT false,  -- holiday-aware day counting
  UNIQUE (org_id, code)
);

CREATE TABLE att.staff_leave_balance (
  staff_id      uuid NOT NULL,
  leave_type_id uuid NOT NULL REFERENCES att.staff_leave_type(id),
  leave_year    smallint NOT NULL,
  entitled_days numeric(5,1) NOT NULL,
  carried_days  numeric(5,1) NOT NULL DEFAULT 0,
  taken_days    numeric(5,1) NOT NULL DEFAULT 0,
  pending_days  numeric(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (staff_id, leave_type_id, leave_year),
  CHECK (taken_days + pending_days <= entitled_days + carried_days)   -- never overdraw
);

CREATE TABLE att.staff_leave_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  staff_id         uuid NOT NULL,
  leave_type_id    uuid NOT NULL REFERENCES att.staff_leave_type(id),
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  half_day         boolean NOT NULL DEFAULT false,
  days             numeric(5,1) NOT NULL,          -- computed holiday-aware
  reason           text,
  attachment_file_id uuid,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (to_date >= from_date)
);  -- std(audit, rls)
CREATE INDEX ix_staff_leave_calendar ON att.staff_leave_request USING gist (campus_id, daterange(from_date, to_date, '[]'))
  WHERE status = 'approved';                       -- substitution planning (ACA-05)
