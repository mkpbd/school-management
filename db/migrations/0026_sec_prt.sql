-- 0026_sec_prt: campus security, visitors & safe pick-up (SEC-01..05); portal forms & consents (PRT-07)

CREATE TABLE sec.visitor (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  full_name     text NOT NULL,
  phone         core.phone_e164,
  id_type       text CHECK (id_type IN ('nid','passport','driving_licence','other')),
  id_no_enc     bytea,
  id_no_bidx    bytea,
  photo_file_id uuid REFERENCES sys.stored_file(id),
  is_watch_listed boolean NOT NULL DEFAULT false,
  watch_reason  text,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_visitor_phone ON sec.visitor (org_id, phone);
CREATE INDEX ix_visitor_bidx  ON sec.visitor (id_no_bidx) WHERE id_no_bidx IS NOT NULL;

CREATE TABLE sec.visit (                           -- SEC-01
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  visitor_id      uuid NOT NULL REFERENCES sec.visitor(id),
  purpose         text NOT NULL,
  host_user_id    uuid,
  pre_registered  boolean NOT NULL DEFAULT false,
  expected_at     timestamptz,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  badge_no        text,
  host_notified_at timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_visit_onsite ON sec.visit (campus_id) WHERE checked_in_at IS NOT NULL AND checked_out_at IS NULL;

CREATE TABLE sec.pickup_authorisation (            -- SEC-02
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  student_id        uuid NOT NULL REFERENCES sis.student(id),
  kind              text NOT NULL CHECK (kind IN ('guardian','standing','adhoc')),
  guardian_id       uuid REFERENCES sis.guardian(id),
  person_name       text,
  person_phone      core.phone_e164,
  person_photo_file_id uuid REFERENCES sys.stored_file(id),
  valid_from        timestamptz NOT NULL,
  valid_to          timestamptz,
  otp_hash          bytea,                         -- adhoc: OTP / QR token
  created_by_user   uuid NOT NULL,
  revoked_at        timestamptz,
  CHECK (kind <> 'guardian' OR guardian_id IS NOT NULL),
  CHECK (kind = 'guardian' OR person_name IS NOT NULL)
);
CREATE INDEX ix_pickup_auth_student ON sec.pickup_authorisation (student_id) WHERE revoked_at IS NULL;

CREATE TABLE sec.pickup_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  student_id        uuid NOT NULL REFERENCES sis.student(id),
  authorisation_id  uuid NOT NULL REFERENCES sec.pickup_authorisation(id),
  verified_by       text NOT NULL CHECK (verified_by IN ('photo','otp','qr','id_card')),
  released_by       uuid NOT NULL,
  released_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sec.gate_event (                      -- SEC-03 RFID/QR gate logs (partitioned monthly)
  id           bigint GENERATED ALWAYS AS IDENTITY,
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  person_type  text NOT NULL CHECK (person_type IN ('student','staff','visitor')),
  person_id    uuid,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  at           timestamptz NOT NULL,
  device_id    uuid,
  kind         text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','late_slip','early_leave_permit','denied')),
  permit_ref   uuid,
  cctv_ref     text,                               -- SEC-04 NVR channel + timestamp for incident review
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE INDEX ix_gate_event_person ON sec.gate_event (person_id, at DESC);

CREATE TABLE sec.early_leave_permit (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  student_id   uuid NOT NULL REFERENCES sis.student(id),
  leave_at     timestamptz NOT NULL,
  reason       text NOT NULL,
  approved_by  uuid NOT NULL,
  pickup_authorisation_id uuid REFERENCES sec.pickup_authorisation(id),
  used_at      timestamptz
);

CREATE TABLE sec.drill (                           -- SEC-05 (P3)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('fire','earthquake','lockdown','evacuation')),
  scheduled_at timestamptz NOT NULL,
  started_at  timestamptz,
  all_clear_at timestamptz,
  report      text
);
CREATE TABLE sec.drill_roll_call (
  drill_id         uuid NOT NULL REFERENCES sec.drill(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL REFERENCES aca.class_section(id),
  expected         smallint NOT NULL,
  accounted        smallint NOT NULL,
  missing_student_ids uuid[] NOT NULL DEFAULT '{}',
  reported_by      uuid NOT NULL,
  reported_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drill_id, class_section_id)
);

-- PRT-07 online forms & consents (trip consent, media consent, medical forms, policy acknowledgements)
CREATE TABLE prt.form_definition (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid,
  code          text NOT NULL,
  title_en      text NOT NULL,
  title_bn      text,
  kind          text NOT NULL CHECK (kind IN ('consent','medical','acknowledgement','survey_like')),
  schema        jsonb NOT NULL,                    -- JSON schema of fields
  requires_signature boolean NOT NULL DEFAULT true,
  audience      jsonb NOT NULL DEFAULT '{}',
  due_at        timestamptz,
  version       integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE NULLS NOT DISTINCT (org_id, campus_id, code, version)
);

CREATE TABLE prt.form_submission (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  form_id          uuid NOT NULL REFERENCES prt.form_definition(id),
  student_id       uuid REFERENCES sis.student(id),
  submitted_by     uuid NOT NULL,
  answers          jsonb NOT NULL,
  signature_name   text,
  signature_file_id uuid REFERENCES sys.stored_file(id),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  ip               inet,
  consent_record_id uuid REFERENCES iam.consent_record(id),
  UNIQUE (form_id, student_id, submitted_by)
);
