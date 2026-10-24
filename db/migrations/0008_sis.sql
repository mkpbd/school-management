-- 0008_sis: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE sis.family (                          -- one login / combined fee view across campuses (I-11)
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  family_code         text NOT NULL,               -- 'FAM-000123'
  billing_guardian_id uuid,                        -- FK added after sis.guardian
  notes               text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, family_code)
);

CREATE TABLE sis.student (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL REFERENCES core.campus(id),   -- current home campus (denormalised from enrolment)
  family_id          uuid NOT NULL REFERENCES sis.family(id),
  user_id            uuid REFERENCES iam.user_account(id),       -- student portal account (senior years)
  admission_no       text NOT NULL,                              -- from core.number_sequence
  first_name_en      text NOT NULL,
  last_name_en       text,
  full_name_en       text GENERATED ALWAYS AS (btrim(first_name_en || ' ' || coalesce(last_name_en, ''))) STORED,
  full_name_bn       text COLLATE core.bn_bd,
  preferred_name     text,
  gender             text NOT NULL CHECK (gender IN ('male','female')),
  date_of_birth      date NOT NULL,
  birth_cert_no_enc  bytea,                                      -- encrypted
  birth_cert_no_bidx bytea,                                      -- HMAC blind index (exact search)
  passport_no_enc    bytea,
  nationality        char(2) NOT NULL DEFAULT 'BD',
  religion           text,
  blood_group        text CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  mother_tongue      text,
  photo_file_id      uuid REFERENCES sys.stored_file(id),
  house_id           uuid,                                       -- FK cca.house
  previous_school    text,
  has_special_needs  boolean NOT NULL DEFAULT false,             -- details in sis.sen_record (restricted)
  rfid_uid           text,                                       -- current ID card chip
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','on_hold','withdrawn','graduated','alumni','deceased')),
  admitted_on        date NOT NULL,
  left_on            date,
  search_text        text GENERATED ALWAYS AS (
                       lower(first_name_en || ' ' || coalesce(last_name_en, '')) || ' ' ||
                       coalesce(full_name_bn, '') || ' ' || lower(admission_no)) STORED,
  deleted_at         timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit[redact birth_cert_no_enc, passport_no_enc], rls)
CREATE UNIQUE INDEX ux_student_admission_no ON sis.student (org_id, admission_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_student_rfid ON sis.student (org_id, rfid_uid) WHERE rfid_uid IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_student_family ON sis.student (family_id);
CREATE INDEX ix_student_bidx   ON sis.student (birth_cert_no_bidx) WHERE birth_cert_no_bidx IS NOT NULL;
CREATE INDEX ix_student_trgm   ON sis.student USING gin (search_text gin_trgm_ops);
CREATE INDEX ix_student_campus_status ON sis.student (campus_id, status) WHERE deleted_at IS NULL;

CREATE TABLE sis.student_address (
  student_id  uuid NOT NULL REFERENCES sis.student(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('present','permanent')),
  line1       text NOT NULL,
  line2       text,
  area        text,
  thana       text,
  district    text,
  postcode    text,
  country     char(2) NOT NULL DEFAULT 'BD',
  PRIMARY KEY (student_id, kind)
);

CREATE TABLE sis.guardian (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  family_id        uuid NOT NULL REFERENCES sis.family(id),
  user_id          uuid REFERENCES iam.user_account(id),        -- parent app login (OTP by phone)
  full_name_en     text NOT NULL,
  full_name_bn     text COLLATE core.bn_bd,
  phone            core.phone_e164 NOT NULL,
  alt_phone        core.phone_e164,
  whatsapp_phone   core.phone_e164,
  email            citext,
  nid_enc          bytea,
  nid_bidx         bytea,
  occupation_code  text,                                        -- core.lookup_value 'occupation'
  employer         text,
  income_band      text,
  is_staff_id      uuid,                                        -- staff-ward concession (FK hrm.staff)
  photo_file_id    uuid REFERENCES sys.stored_file(id),         -- authorised pick-up photo
  preferred_locale core.locale NOT NULL DEFAULT 'bn',
  deleted_at       timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit[redact nid_enc])
CREATE INDEX ix_guardian_phone  ON sis.guardian (org_id, phone);
CREATE INDEX ix_guardian_family ON sis.guardian (family_id);
CREATE INDEX ix_guardian_trgm   ON sis.guardian USING gin ((lower(full_name_en) || ' ' || coalesce(full_name_bn,'') || ' ' || phone) gin_trgm_ops);
ALTER TABLE sis.family ADD FOREIGN KEY (billing_guardian_id) REFERENCES sis.guardian(id);

CREATE TABLE sis.student_guardian (
  student_id        uuid NOT NULL REFERENCES sis.student(id) ON DELETE CASCADE,
  guardian_id       uuid NOT NULL REFERENCES sis.guardian(id),
  relationship      text NOT NULL CHECK (relationship IN ('father','mother','grandfather','grandmother','uncle',
                                                         'aunt','sibling','legal_guardian','other')),
  is_primary_contact boolean NOT NULL DEFAULT false,            -- receives absence SMS
  is_fee_payer      boolean NOT NULL DEFAULT false,
  can_pickup        boolean NOT NULL DEFAULT false,             -- SEC-02
  has_custody       boolean NOT NULL DEFAULT true,
  portal_access     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (student_id, guardian_id)
);  -- std(audit)
CREATE UNIQUE INDEX ux_student_primary_contact ON sis.student_guardian (student_id) WHERE is_primary_contact;

CREATE TABLE sis.enrolment (                       -- one row per student per placement per year (I-12)
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL REFERENCES core.campus(id),
  academic_year_id   uuid NOT NULL REFERENCES core.academic_year(id),
  student_id         uuid NOT NULL REFERENCES sis.student(id),
  class_section_id   uuid NOT NULL REFERENCES aca.class_section(id),
  year_group_id      uuid NOT NULL REFERENCES aca.year_group(id),   -- denormalised for reporting
  roll_no            smallint,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','transferred_out','promoted','repeated','withdrawn','graduated')),
  starts_on          date NOT NULL,
  ends_on            date,
  end_reason         text,
  previous_enrolment_id uuid REFERENCES sis.enrolment(id),         -- chain for mid-year transfers
  promotion_decision text CHECK (promotion_decision IN ('promote','conditional','repeat','hold','graduate')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  EXCLUDE USING gist (student_id WITH =, daterange(starts_on, coalesce(ends_on, 'infinity'), '[]') WITH &&)  -- never two placements at once
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_enrolment_roll ON sis.enrolment (class_section_id, roll_no)
  WHERE status = 'active' AND roll_no IS NOT NULL;
CREATE INDEX ix_enrolment_section_active ON sis.enrolment (class_section_id) WHERE status = 'active';
CREATE INDEX ix_enrolment_student_year   ON sis.enrolment (student_id, academic_year_id);

CREATE TABLE sis.student_subject (                 -- chosen electives per enrolment (ACA-02)
  enrolment_id uuid NOT NULL REFERENCES sis.enrolment(id) ON DELETE CASCADE,
  subject_id   uuid NOT NULL REFERENCES aca.subject(id),
  chosen_on    date NOT NULL DEFAULT current_date,
  PRIMARY KEY (enrolment_id, subject_id)
);

CREATE TABLE sis.student_document (                -- SIS-03 document vault
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL,
  student_id          uuid NOT NULL REFERENCES sis.student(id),
  doc_type            text NOT NULL,               -- lookup 'student_doc_type': birth_cert, prev_report, vaccination...
  file_id             uuid NOT NULL REFERENCES sys.stored_file(id),
  expires_on          date,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  verified_by         uuid,
  verified_at         timestamptz,
  deleted_at          timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE TABLE sis.sen_record (                      -- SIS-08 restricted (break-glass)
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id                uuid NOT NULL,
  campus_id             uuid NOT NULL,
  student_id            uuid NOT NULL REFERENCES sis.student(id),
  category              text NOT NULL,
  details_enc           bytea NOT NULL,             -- IEP, diagnosis (encrypted)
  access_arrangements   text[] NOT NULL DEFAULT '{}', -- 'extra_time_25','reader','separate_room' (shared with EXM)
  review_on             date,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit[redact details_enc], rls)

CREATE TABLE sis.profile_change_request (          -- PRT-07 guardian-requested updates with approval
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  target_type   text NOT NULL CHECK (target_type IN ('student','guardian','address')),
  target_id     uuid NOT NULL,
  requested_by  uuid NOT NULL,
  changes       jsonb NOT NULL,                    -- {"phone": {"from": "...", "to": "..."}}
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by    uuid,
  decided_at    timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE TABLE sis.withdrawal (                      -- SIS-06 with dues clearance
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  requested_on     date NOT NULL,
  effective_on     date NOT NULL,
  reason_code      text NOT NULL,
  reason_note      text,
  clearance        jsonb NOT NULL DEFAULT '{}',    -- {"fee": {"ok": true, "by": ..}, "library": {...}, "transport":..., "store":...}
  status           text NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','clearance_pending','cleared','completed','cancelled')),
  tc_document_id   uuid,                           -- doc.issued_document
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE TABLE sis.id_card_issue (                   -- SIS-09
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid NOT NULL,
  student_id     uuid NOT NULL REFERENCES sis.student(id),
  card_no        text NOT NULL,
  rfid_uid       text,
  reason         text NOT NULL CHECK (reason IN ('new','lost','damaged','renewal')),
  issued_on      date NOT NULL,
  invoice_line_id uuid,                            -- reissue fee
  UNIQUE (org_id, card_no)
);  -- std(rls)

CREATE TABLE sis.alumni_profile (                  -- SIS-10 (P3)
  student_id          uuid PRIMARY KEY REFERENCES sis.student(id),
  graduation_year     smallint NOT NULL,
  destination         text,                        -- university / employer
  contact_consent     boolean NOT NULL DEFAULT false,
  contact_email       citext,
  contact_phone       core.phone_e164
);
