-- 0035_hrm_payroll: monthly payroll workflow (HRM-04) on top of 0014_hrm
--   * maker-checker: the approver can never be the submitter (DB check, not only the API)
--   * per-month inputs (unpaid leave, overtime, cover periods, one-off adjustments) survive re-computation
--   * loan / advance recoveries recorded per payroll run (outstanding reduced on lock)
--   * salaries are campus data: payslips get org/campus columns and RLS; locked payrolls are immutable

ALTER TABLE hrm.payroll_run
  ADD COLUMN included_components text[] NOT NULL DEFAULT '{}',   -- occasional components this month (FEST_BONUS)
  ADD COLUMN computed_at       timestamptz,
  ADD COLUMN submitted_by      uuid,
  ADD COLUMN submitted_at      timestamptz,
  ADD COLUMN approved_by       uuid,
  ADD COLUMN approved_at       timestamptz,
  ADD COLUMN decision_note     text,
  ADD COLUMN paid_at           timestamptz,
  ADD COLUMN payment_reference text,
  ADD CONSTRAINT ck_payroll_maker_checker CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM submitted_by);

-- payslips: tenant columns for RLS (backfilled from the run)
ALTER TABLE hrm.payslip ADD COLUMN org_id uuid, ADD COLUMN campus_id uuid;
UPDATE hrm.payslip p SET org_id = r.org_id, campus_id = r.campus_id FROM hrm.payroll_run r WHERE r.id = p.payroll_run_id;
ALTER TABLE hrm.payslip ALTER COLUMN org_id SET NOT NULL, ALTER COLUMN campus_id SET NOT NULL;
ALTER TABLE hrm.payslip
  ADD COLUMN employer_contribution_paisa core.paisa NOT NULL DEFAULT 0,
  ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]';
CREATE INDEX ix_payslip_staff ON hrm.payslip (staff_id);

ALTER TABLE hrm.payslip_line ADD COLUMN kind text NOT NULL DEFAULT 'earning'
  CHECK (kind IN ('earning','deduction','employer_contribution'));

CREATE TABLE hrm.payroll_input (                   -- what HR enters for the month; computation reads it
  payroll_run_id   uuid NOT NULL REFERENCES hrm.payroll_run(id) ON DELETE CASCADE,
  staff_id         uuid NOT NULL REFERENCES hrm.staff(id),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  lwp_days         numeric(4,1) NOT NULL DEFAULT 0 CHECK (lwp_days >= 0 AND lwp_days <= 31),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  cover_periods    smallint NOT NULL DEFAULT 0 CHECK (cover_periods >= 0),
  adjustments      jsonb NOT NULL DEFAULT '[]',     -- [{componentCode, amountPaisa, note}]
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid DEFAULT core.current_user_id(),
  PRIMARY KEY (payroll_run_id, staff_id)
);

ALTER TABLE hrm.staff_loan
  ADD COLUMN org_id     uuid,
  ADD COLUMN reason     text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by uuid DEFAULT core.current_user_id();
UPDATE hrm.staff_loan l SET org_id = s.org_id FROM hrm.staff s WHERE s.id = l.staff_id;
ALTER TABLE hrm.staff_loan ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE hrm.staff_loan ADD CONSTRAINT ck_loan_amounts
  CHECK (installment_paisa > 0 AND installment_paisa <= principal_paisa AND outstanding_paisa <= principal_paisa);
CREATE INDEX ix_staff_loan_active ON hrm.staff_loan (staff_id) WHERE status = 'active';

CREATE TABLE hrm.loan_recovery (                   -- one installment taken by one payroll
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  staff_loan_id  uuid NOT NULL REFERENCES hrm.staff_loan(id),
  payroll_run_id uuid NOT NULL REFERENCES hrm.payroll_run(id),
  amount_paisa   core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  recovered_on   date NOT NULL,
  UNIQUE (staff_loan_id, payroll_run_id)
);

-- A locked / paid payroll is frozen: payslips and lines cannot change, the run only moves locked -> paid.
CREATE FUNCTION hrm.tg_payroll_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'payroll_run' THEN
    IF OLD.status IN ('locked','paid') AND NOT (
         OLD.status = 'locked' AND NEW.status = 'paid'
         AND NEW.gross_paisa IS NOT DISTINCT FROM OLD.gross_paisa
         AND NEW.net_paisa IS NOT DISTINCT FROM OLD.net_paisa
         AND NEW.deductions_paisa IS NOT DISTINCT FROM OLD.deductions_paisa) THEN
      RAISE EXCEPTION 'payroll run % is %; it cannot be changed', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'payslip' THEN
    v_run := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  ELSE
    SELECT payroll_run_id INTO v_run FROM hrm.payslip WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  END IF;
  SELECT status INTO v_status FROM hrm.payroll_run WHERE id = v_run;
  IF v_status IN ('locked','paid') THEN
    RAISE EXCEPTION 'payroll run % is %; payslips are frozen', v_run, v_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_payroll_frozen BEFORE UPDATE ON hrm.payroll_run
  FOR EACH ROW EXECUTE FUNCTION hrm.tg_payroll_frozen();
CREATE TRIGGER trg_payroll_frozen BEFORE INSERT OR UPDATE OR DELETE ON hrm.payslip
  FOR EACH ROW EXECUTE FUNCTION hrm.tg_payroll_frozen();
CREATE TRIGGER trg_payroll_frozen BEFORE INSERT OR UPDATE OR DELETE ON hrm.payslip_line
  FOR EACH ROW EXECUTE FUNCTION hrm.tg_payroll_frozen();

CALL core.enable_campus_rls('hrm.payslip');
CALL core.enable_campus_rls('hrm.payroll_input');
CALL core.enable_org_rls('hrm.staff_loan');
CALL core.enable_org_rls('hrm.loan_recovery');

COMMENT ON TABLE hrm.payroll_input IS 'Monthly payroll inputs per staff (unpaid leave, overtime, cover periods, one-off adjustments). [HRM-04]';
COMMENT ON TABLE hrm.loan_recovery IS 'Loan / advance installment taken by a locked payroll run. [HRM-04]';
COMMENT ON COLUMN hrm.payroll_run.included_components IS 'Occasional components paid this month only, e.g. FEST_BONUS';
COMMENT ON CONSTRAINT ck_payroll_maker_checker ON hrm.payroll_run IS 'Maker-checker: the approver is never the submitter';
