-- 0036_hrm_tax: Bangladesh salary TDS (ITA 2023 s.86 style monthly deduction) for payroll
--   * tax rules per income year are data (thresholds per category, slabs, salary exemption, rebate, minimum tax)
--     because they change with every Finance Act; a table is marked verified once someone checked it
--   * staff tax profile per income year (category, declared investment for the rebate)
--   * every payslip keeps its taxable income so year-to-date projections never re-derive history

CREATE TABLE hrm.tax_year (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  code         text NOT NULL,                      -- income year '2026-27' (July-June)
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  rules        jsonb NOT NULL,                     -- see backend hrm/domain/tax.ts TaxRules
  source_note  text,
  verified_by  uuid,
  verified_at  timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code),
  CHECK (ends_on > starts_on),
  EXCLUDE USING gist (org_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE TABLE hrm.staff_tax_profile (
  staff_id                  uuid NOT NULL REFERENCES hrm.staff(id),
  org_id                    uuid NOT NULL,
  tax_year_code             text NOT NULL,
  category                  text NOT NULL DEFAULT 'general'
                            CHECK (category IN ('general','female','senior','disabled','third_gender','freedom_fighter')),
  declared_investment_paisa core.paisa_nn NOT NULL DEFAULT 0,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid DEFAULT core.current_user_id(),
  PRIMARY KEY (staff_id, tax_year_code)
);

ALTER TABLE hrm.payslip ADD COLUMN taxable_paisa core.paisa NOT NULL DEFAULT 0;

CALL core.enable_touch('hrm.tax_year');
CALL core.enable_org_rls('hrm.tax_year');
CALL core.enable_org_rls('hrm.staff_tax_profile');

COMMENT ON TABLE hrm.tax_year IS 'Income-tax rules of an income year (thresholds, slabs, salary exemption, rebate, minimum tax) used for salary TDS. [HRM-04]';
COMMENT ON TABLE hrm.staff_tax_profile IS 'Tax category and declared investment of a staff member for an income year. [HRM-04]';
COMMENT ON COLUMN hrm.payslip.taxable_paisa IS 'Taxable salary of the month (year-to-date TDS projection)';
