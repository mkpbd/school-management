-- 0024_hlt: health, welfare & pastoral care (HLT-01..07). Confidential data is encrypted (_enc) at application level;
-- restricted tables are reached only through break-glass-logged use cases.

CREATE TABLE hlt.health_profile (                  -- HLT-01
  student_id         uuid PRIMARY KEY REFERENCES sis.student(id),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  allergies_enc      bytea,
  conditions_enc     bytea,
  medications_enc    bytea,
  alert_summary      text,                         -- need-to-know line shown to class teacher, e.g. 'Severe nut allergy - EpiPen in sick bay'
  has_alert          boolean NOT NULL DEFAULT false,
  treatment_consent  boolean NOT NULL DEFAULT false,
  doctor_name        text,
  doctor_phone       core.phone_e164,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE hlt.immunisation (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  student_id  uuid NOT NULL REFERENCES sis.student(id),
  vaccine     text NOT NULL,
  dose_no     smallint,
  given_on    date,
  evidence_file_id uuid REFERENCES sys.stored_file(id)
);

CREATE TABLE hlt.sickbay_visit (                   -- HLT-02
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  visited_at       timestamptz NOT NULL DEFAULT now(),
  symptoms         text NOT NULL,
  treatment        text,
  temperature_c    numeric(4,1),
  outcome          text NOT NULL CHECK (outcome IN ('returned_to_class','rested','sent_home','referred_hospital')),
  guardian_notified_at timestamptz,
  attended_by      uuid NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_sickbay_student ON hlt.sickbay_visit (student_id, visited_at DESC);   -- repeated-visit alerts

CREATE TABLE hlt.health_checkup (                  -- HLT-03
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  student_id  uuid NOT NULL REFERENCES sis.student(id),
  checked_on  date NOT NULL,
  height_cm   numeric(5,1),
  weight_kg   numeric(5,1),
  bmi         numeric(4,1) GENERATED ALWAYS AS (round(weight_kg / nullif((height_cm / 100) ^ 2, 0), 1)) STORED,
  vision_left text,
  vision_right text,
  dental_note text,
  camp_name   text,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE hlt.behaviour_incident (              -- HLT-05 merit/demerit, incidents, sanctions
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  kind             text NOT NULL CHECK (kind IN ('merit','demerit','incident')),
  category_code    text NOT NULL,
  points           smallint NOT NULL DEFAULT 0,   -- + merit / - demerit (feeds house points)
  occurred_at      timestamptz NOT NULL,
  description      text NOT NULL,
  sanction         text,
  reported_by      uuid NOT NULL,
  guardian_notified_at timestamptz,
  status           text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','under_review','closed')),
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_behaviour_student ON hlt.behaviour_incident (student_id, occurred_at DESC);

CREATE TABLE hlt.counselling_case (                -- HLT-04 restricted
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  student_id      uuid NOT NULL REFERENCES sis.student(id),
  counsellor_id   uuid NOT NULL,
  referral_source text,
  risk_level      text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  opened_on       date NOT NULL,
  closed_on       date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','closed','referred_out')),
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE TABLE hlt.counselling_note (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES hlt.counselling_case(id),
  author_id   uuid NOT NULL,
  session_at  timestamptz NOT NULL,
  note_enc    bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hlt.safeguarding_concern (            -- HLT-06 restricted, escalation chain
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  raised_by        uuid NOT NULL,
  raised_at        timestamptz NOT NULL DEFAULT now(),
  category         text NOT NULL,
  details_enc      bytea NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','immediate')),
  dsl_user_id      uuid,                           -- designated safeguarding lead
  status           text NOT NULL DEFAULT 'raised' CHECK (status IN ('raised','triaged','escalated','external_referral','closed')),
  escalation_level smallint NOT NULL DEFAULT 0,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE TABLE hlt.safeguarding_action (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  concern_id  uuid NOT NULL REFERENCES hlt.safeguarding_concern(id),
  actor_id    uuid NOT NULL,
  action      text NOT NULL,
  note_enc    bytea,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hlt.bullying_case (                   -- HLT-07
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  reported_at     timestamptz NOT NULL DEFAULT now(),
  reported_by     uuid NOT NULL,
  target_student_ids uuid[] NOT NULL,
  alleged_student_ids uuid[] NOT NULL DEFAULT '{}',
  description     text NOT NULL,
  investigation   jsonb NOT NULL DEFAULT '[]',   -- steps
  outcome         text,
  follow_up_on    date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed')),
  LIKE core.std_cols INCLUDING DEFAULTS
);
