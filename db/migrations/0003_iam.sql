-- 0003_iam: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE iam.user_account (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL REFERENCES core.organisation(id),
  user_type          text NOT NULL CHECK (user_type IN ('staff','guardian','student','system')),
  username           citext,                       -- staff/student login id
  email              citext,
  phone              core.phone_e164,              -- guardian OTP login
  password_hash      text,                         -- argon2id; NULL for OTP-only guardians
  status             text NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited','active','locked','disabled')),
  mfa_type           text CHECK (mfa_type IN ('totp','sms_otp')),
  mfa_secret_enc     bytea,
  must_change_password boolean NOT NULL DEFAULT false,
  preferred_locale   core.locale NOT NULL DEFAULT 'en',
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  password_changed_at timestamptz,
  authz_version      integer NOT NULL DEFAULT 1,   -- bump => cached permissions invalidated
  deleted_at         timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE UNIQUE INDEX ux_user_username ON iam.user_account (org_id, username) WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_user_email    ON iam.user_account (org_id, email)    WHERE email    IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_user_phone    ON iam.user_account (org_id, phone)    WHERE phone    IS NOT NULL AND deleted_at IS NULL
                                                                              AND user_type = 'guardian';

CREATE TABLE iam.external_identity (               -- Google / Microsoft SSO (CORE-10)
  user_id    uuid NOT NULL REFERENCES iam.user_account(id),
  provider   text NOT NULL CHECK (provider IN ('google','microsoft')),
  subject    text NOT NULL,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE iam.role (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  code        text NOT NULL,                       -- PRINCIPAL, CAMPUS_HEAD, HOS, CLASS_TEACHER, SUBJECT_TEACHER,
                                                   -- ACCOUNTANT, CASHIER, ADMISSION_OFFICER, HR, EXAM_OFFICER,
                                                   -- LIBRARIAN, TRANSPORT, NURSE, COUNSELLOR, IT_ADMIN, PARENT, STUDENT
  name_en     text NOT NULL,
  name_bn     text,
  is_system   boolean NOT NULL DEFAULT false,      -- seeded, cannot be deleted
  requires_mfa boolean NOT NULL DEFAULT false,     -- §5.5 accounts/HR/IT/principal
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE iam.permission (                      -- seeded from packages/contracts/permissions.ts
  code        text PRIMARY KEY,                    -- 'fee.invoice.create'
  module      text NOT NULL,
  resource    text NOT NULL,
  action      text NOT NULL CHECK (action IN ('view','create','edit','approve','export','delete')),
  is_sensitive boolean NOT NULL DEFAULT false,     -- break-glass logging
  description text
);

CREATE TABLE iam.role_permission (
  role_id         uuid NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES iam.permission(code),
  data_scope      text NOT NULL DEFAULT 'campus'
                  CHECK (data_scope IN ('org','campus','section','own_classes','own_subjects','own_children','self')),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE iam.role_assignment (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES iam.user_account(id),
  role_id    uuid NOT NULL REFERENCES iam.role(id),
  scope_type text NOT NULL CHECK (scope_type IN ('org','campus')),
  campus_id  uuid REFERENCES core.campus(id),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to   date,
  granted_by uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK ((scope_type = 'org' AND campus_id IS NULL) OR (scope_type = 'campus' AND campus_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, campus_id)
);  -- std(audit)  -- permission changes are audited (§5.5)

CREATE TABLE iam.refresh_token (                   -- rotating refresh tokens with reuse detection
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES iam.user_account(id),
  family_id   uuid NOT NULL,                       -- all rotations of one login
  token_hash  bytea NOT NULL UNIQUE,               -- sha256(token)
  client      text NOT NULL CHECK (client IN ('web','parent_app','staff_app','scanner')),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  revoke_reason text,
  ip          inet,
  user_agent  text
);
CREATE INDEX ix_refresh_token_family ON iam.refresh_token (family_id);
CREATE INDEX ix_refresh_token_user_active ON iam.refresh_token (user_id) WHERE revoked_at IS NULL;

CREATE TABLE iam.otp_challenge (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  phone       core.phone_e164,
  email       citext,
  user_id     uuid REFERENCES iam.user_account(id),
  purpose     text NOT NULL CHECK (purpose IN ('login','mfa','reset_password','verify_phone','result_lookup','pickup')),
  code_hash   bytea NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.consent_record (                  -- CORE-11 data privacy, PRT-07 consents
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  guardian_id  uuid NOT NULL,
  student_id   uuid,
  consent_type text NOT NULL,                      -- 'photo_media','data_processing','medical_treatment','trip:<id>'
  granted      boolean NOT NULL,
  version      text NOT NULL,                      -- policy version
  signed_name  text,
  evidence_file_id uuid,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX ix_consent_student ON iam.consent_record (student_id, consent_type);

CREATE TABLE iam.break_glass_access (              -- confidential record access log (SEN, safeguarding, counselling)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  user_id       uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id   uuid NOT NULL,
  reason        text NOT NULL,
  accessed_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text
);
