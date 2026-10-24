-- 0014_hrm: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE hrm.department  (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, code text NOT NULL,
                              name_en text NOT NULL, head_staff_id uuid, UNIQUE (org_id, code));
CREATE TABLE hrm.designation (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, code text NOT NULL,
                              name_en text NOT NULL, name_bn text, grade text, UNIQUE (org_id, code));

CREATE TABLE hrm.staff (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL REFERENCES core.campus(id),   -- primary campus
  user_id            uuid REFERENCES iam.user_account(id),
  staff_no           text NOT NULL,
  full_name_en       text NOT NULL,
  full_name_bn       text COLLATE core.bn_bd,
  gender             text NOT NULL CHECK (gender IN ('male','female')),
  date_of_birth      date,
  nid_enc            bytea,
  nid_bidx           bytea,
  tin_enc            bytea,
  phone              core.phone_e164 NOT NULL,
  email              citext,
  staff_type         text NOT NULL CHECK (staff_type IN ('teaching','non_teaching','admin','support')),
  department_id      uuid REFERENCES hrm.department(id),
  designation_id     uuid REFERENCES hrm.designation(id),
  reporting_to_id    uuid REFERENCES hrm.staff(id),
  joined_on          date NOT NULL,
  confirmed_on       date,
  left_on            date,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('onboarding','probation','active','on_leave','resigned','terminated','retired')),
  bank_account_enc   bytea,                         -- {bank, branch, routing, account} encrypted JSON
  emergency_contact  jsonb,
  photo_file_id      uuid REFERENCES sys.stored_file(id),
  rfid_uid           text,
  biometric_pin      text,
  search_text        text GENERATED ALWAYS AS (lower(full_name_en) || ' ' || coalesce(full_name_bn, '') || ' ' ||
                                               lower(staff_no) || ' ' || phone) STORED,
  deleted_at         timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit[redact nid_enc, tin_enc, bank_account_enc], rls)
CREATE UNIQUE INDEX ux_staff_no ON hrm.staff (org_id, staff_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_staff_trgm ON hrm.staff USING gin (search_text gin_trgm_ops);

CREATE TABLE hrm.staff_campus (                    -- teachers working on several campuses
  staff_id  uuid NOT NULL REFERENCES hrm.staff(id),
  campus_id uuid NOT NULL REFERENCES core.campus(id),
  PRIMARY KEY (staff_id, campus_id)
);

CREATE TABLE hrm.staff_document (                  -- certificates, contracts with expiry alerts
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id    uuid NOT NULL REFERENCES hrm.staff(id),
  doc_type    text NOT NULL,
  file_id     uuid NOT NULL REFERENCES sys.stored_file(id),
  expires_on  date,
  verified    boolean NOT NULL DEFAULT false
);
CREATE INDEX ix_staff_doc_expiry ON hrm.staff_document (expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE hrm.qualification (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id    uuid NOT NULL REFERENCES hrm.staff(id),
  kind        text NOT NULL CHECK (kind IN ('degree','teaching_credential','certification','experience')),
  title       text NOT NULL,
  institution text,
  from_date   date,
  to_date     date,
  file_id     uuid
);

CREATE TABLE hrm.salary_component (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  code      text NOT NULL,                         -- BASIC, HOUSE, MEDICAL, CONVEYANCE, COVER_PAY, OT, FEST_BONUS,
                                                   -- PF, TAX, LOAN, ADVANCE, LWP
  name_en   text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('earning','deduction','employer_contribution')),
  calc      text NOT NULL CHECK (calc IN ('fixed','percent_of_basic','per_unit','formula')),
  formula   text,                                  -- safe expression evaluated in domain (no eval)
  taxable   boolean NOT NULL DEFAULT true,
  seq       smallint NOT NULL DEFAULT 0,
  UNIQUE (org_id, code)
);

CREATE TABLE hrm.contract (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  staff_id         uuid NOT NULL REFERENCES hrm.staff(id),
  contract_type    text NOT NULL CHECK (contract_type IN ('permanent','fixed_term','part_time','hourly','probation')),
  starts_on        date NOT NULL,
  ends_on          date,
  probation_ends_on date,
  basic_paisa      core.paisa_nn NOT NULL,
  file_id          uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  EXCLUDE USING gist (staff_id WITH =, daterange(starts_on, coalesce(ends_on, 'infinity'), '[]') WITH &&)
);  -- std(audit)

CREATE TABLE hrm.contract_component (
  contract_id  uuid NOT NULL REFERENCES hrm.contract(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES hrm.salary_component(id),
  amount_paisa core.paisa_nn,
  percent      numeric(6,3),
  PRIMARY KEY (contract_id, component_id),
  CHECK ((amount_paisa IS NULL) <> (percent IS NULL))
);

CREATE TABLE hrm.payroll_run (                     -- HRM-04 locked monthly payroll with approval
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL,
  period_month        date NOT NULL CHECK (extract(day FROM period_month) = 1),
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','computed','submitted','approved','locked','paid','cancelled')),
  gross_paisa         core.paisa,
  deductions_paisa    core.paisa,
  net_paisa           core.paisa,
  approval_request_id uuid,
  bank_advice_file_id uuid,
  locked_at           timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_payroll_period ON hrm.payroll_run (campus_id, period_month) WHERE status <> 'cancelled';

CREATE TABLE hrm.payslip (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  payroll_run_id    uuid NOT NULL REFERENCES hrm.payroll_run(id),
  staff_id          uuid NOT NULL REFERENCES hrm.staff(id),
  working_days      numeric(4,1) NOT NULL,
  paid_days         numeric(4,1) NOT NULL,
  lwp_days          numeric(4,1) NOT NULL DEFAULT 0,
  cover_periods     smallint NOT NULL DEFAULT 0,       -- from aca.substitution
  overtime_minutes  integer NOT NULL DEFAULT 0,
  gross_paisa       core.paisa NOT NULL,
  deductions_paisa  core.paisa NOT NULL,
  tax_paisa         core.paisa NOT NULL DEFAULT 0,
  net_paisa         core.paisa NOT NULL,
  file_id           uuid,
  UNIQUE (payroll_run_id, staff_id)
);
CREATE TABLE hrm.payslip_line (
  payslip_id   uuid NOT NULL REFERENCES hrm.payslip(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES hrm.salary_component(id),
  quantity     numeric(8,2),
  amount_paisa core.paisa NOT NULL,
  note         text,
  PRIMARY KEY (payslip_id, component_id)
);

CREATE TABLE hrm.staff_loan (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id           uuid NOT NULL REFERENCES hrm.staff(id),
  kind               text NOT NULL CHECK (kind IN ('loan','advance')),
  principal_paisa    core.paisa_nn NOT NULL,
  installment_paisa  core.paisa_nn NOT NULL,
  outstanding_paisa  core.paisa_nn NOT NULL,
  starts_month       date NOT NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','written_off')),
  approval_request_id uuid
);
-- P2 HRM tables (recruitment, onboarding/exit, appraisal, CPD): see 0018_hrm_p2.sql
