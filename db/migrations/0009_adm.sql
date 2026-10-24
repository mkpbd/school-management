-- 0009_adm: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE adm.enquiry (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  year_group_id      uuid REFERENCES aca.year_group(id),
  source_code        text NOT NULL,                -- lookup 'lead_source': website, phone, walk_in, facebook, qr, referral
  campaign_code      text,
  utm                jsonb,
  child_name         text NOT NULL,
  child_dob          date,
  guardian_name      text NOT NULL,
  phone              core.phone_e164 NOT NULL,
  email              citext,
  stage              text NOT NULL DEFAULT 'enquiry'
                     CHECK (stage IN ('enquiry','visit_scheduled','visited','applied','test_scheduled','tested',
                                      'offered','admitted','lost')),
  lost_reason_code   text,
  assigned_to        uuid,                          -- counsellor user
  next_follow_up_at  timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE INDEX ix_enquiry_pipeline ON adm.enquiry (campus_id, academic_year_id, stage);
CREATE INDEX ix_enquiry_followup ON adm.enquiry (assigned_to, next_follow_up_at) WHERE stage NOT IN ('admitted','lost');

CREATE TABLE adm.enquiry_activity (                -- calls, visits, notes, stage changes
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enquiry_id  uuid NOT NULL REFERENCES adm.enquiry(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('call','sms','email','visit','note','stage_change','task')),
  notes       text,
  due_at      timestamptz,
  done_at     timestamptz,
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adm.application (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id                uuid NOT NULL,
  campus_id             uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  year_group_id         uuid NOT NULL REFERENCES aca.year_group(id),
  enquiry_id            uuid REFERENCES adm.enquiry(id),
  application_no        text,                      -- assigned on submit
  applicant_user_id     uuid REFERENCES iam.user_account(id),   -- guardian account created at draft
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','fee_pending','under_review','test_scheduled','tested',
                                          'shortlisted','waitlisted','offered','accepted','declined','enrolled',
                                          'rejected','withdrawn','expired')),
  child_first_name      text NOT NULL,
  child_last_name       text,
  child_name_bn         text,
  child_gender          text NOT NULL CHECK (child_gender IN ('male','female')),
  child_dob             date NOT NULL,
  previous_school       text,
  form_data             jsonb NOT NULL DEFAULT '{}',   -- guardians, addresses, medical, answers (snapshot until enrolment)
  sibling_student_id    uuid REFERENCES sis.student(id),
  staff_ward_staff_id   uuid,
  application_fee_invoice_id uuid,
  submitted_at          timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_application_no ON adm.application (org_id, application_no) WHERE application_no IS NOT NULL;
CREATE INDEX ix_application_status ON adm.application (campus_id, academic_year_id, year_group_id, status);

CREATE TABLE adm.application_document (
  application_id uuid NOT NULL REFERENCES adm.application(id) ON DELETE CASCADE,
  doc_type       text NOT NULL,
  file_id        uuid NOT NULL REFERENCES sys.stored_file(id),
  verified       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (application_id, doc_type, file_id)
);

CREATE TABLE adm.test_session (                    -- ADM-04
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  year_group_id    uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('written_test','interview','assessment_play')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  room_id          uuid REFERENCES core.room(id),
  capacity         smallint NOT NULL,
  components       jsonb NOT NULL DEFAULT '[]',    -- [{"code":"ENG","max":50},{"code":"MATH","max":50}]
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(rls)

CREATE TABLE adm.test_candidate (
  test_session_id uuid NOT NULL REFERENCES adm.test_session(id),
  application_id  uuid NOT NULL REFERENCES adm.application(id),
  admit_card_no   text NOT NULL,
  seat_no         text,
  attended        boolean,
  scores          jsonb NOT NULL DEFAULT '{}',     -- {"ENG": 41, "MATH": 38}
  total_score     numeric(6,2),
  interviewer_ids uuid[] NOT NULL DEFAULT '{}',
  interview_notes text,
  rating          smallint CHECK (rating BETWEEN 1 AND 5),
  PRIMARY KEY (test_session_id, application_id)
);

CREATE TABLE adm.selection_rule (                  -- ADM-05 rule-based shortlisting
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  year_group_id    uuid NOT NULL,
  age_reference_date date NOT NULL,
  min_age_months   smallint,
  max_age_months   smallint,
  min_total_score  numeric(6,2),
  weights          jsonb NOT NULL DEFAULT '{}',    -- {"test": 0.8, "interview": 0.2, "sibling_bonus": 5, "staff_ward_bonus": 5}
  seats            smallint NOT NULL,
  UNIQUE (campus_id, academic_year_id, year_group_id)
);

CREATE TABLE adm.merit_list (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  year_group_id    uuid NOT NULL,
  round_no         smallint NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published')),
  generated_at     timestamptz NOT NULL DEFAULT now(),
  approved_by      uuid,
  UNIQUE (campus_id, academic_year_id, year_group_id, round_no)
);  -- std(audit, rls)

CREATE TABLE adm.merit_list_entry (
  merit_list_id  uuid NOT NULL REFERENCES adm.merit_list(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES adm.application(id),
  rank           integer NOT NULL,
  score          numeric(7,3) NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('offer','waitlist','reject')),
  waitlist_position integer,
  PRIMARY KEY (merit_list_id, application_id),
  UNIQUE (merit_list_id, rank)
);

CREATE TABLE adm.offer (                           -- ADM-06
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  application_id   uuid NOT NULL REFERENCES adm.application(id),
  offer_no         text NOT NULL,
  class_section_id uuid REFERENCES aca.class_section(id),  -- optional pre-allocation
  fee_schedule     jsonb NOT NULL,                 -- snapshot of fees shown in the letter
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','accepted','declined','expired','revoked')),
  responded_at     timestamptz,
  letter_document_id uuid,
  admission_invoice_id uuid,                       -- ADM-07
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, offer_no)
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_offer_live ON adm.offer (application_id) WHERE status IN ('issued','accepted');
CREATE INDEX ix_offer_expiry ON adm.offer (expires_at) WHERE status = 'issued';   -- auto seat release job

CREATE TABLE adm.enrolment_conversion (            -- ADM-08 idempotent conversion record
  application_id uuid PRIMARY KEY REFERENCES adm.application(id),
  student_id     uuid NOT NULL REFERENCES sis.student(id),
  enrolment_id   uuid NOT NULL REFERENCES sis.enrolment(id),
  converted_at   timestamptz NOT NULL DEFAULT now(),
  converted_by   uuid NOT NULL
);
