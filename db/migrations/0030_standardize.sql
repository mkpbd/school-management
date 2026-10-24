-- 0030_standardize: apply cross-cutting behaviour to every table by convention (catalog-driven, re-runnable).
--   1. trg_touch    on every table that has updated_at + row_version
--   2. RLS          campus policy where (org_id, campus_id) exist; org policy where only org_id exists
--   3. trg_audit    on the explicit list of sensitive tables (encrypted / secret columns auto-redacted)

-- 1 + 2 -------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  -- tables read before a request context exists, or written by system processes across orgs
  rls_excluded text[] := ARRAY['sys.outbox_event','sys.processed_event','sys.idempotency_key',
                               'web.api_client','iam.permission','core.std_cols','core.organisation'];
BEGIN
  FOR r IN
    SELECT t.oid::regclass AS tbl, n.nspname, t.relname,
           bool_or(a.attname = 'updated_at') AND bool_or(a.attname = 'row_version') AS has_std,
           bool_or(a.attname = 'org_id')    AS has_org,
           bool_or(a.attname = 'campus_id') AS has_campus
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','public','audit','partman')
       AND n.nspname NOT LIKE 'pg\_%'
       AND t.relkind IN ('r','p') AND NOT t.relispartition
     GROUP BY t.oid, n.nspname, t.relname
  LOOP
    IF r.has_std AND (r.nspname || '.' || r.relname) <> 'core.std_cols' THEN
      CALL core.enable_touch(r.tbl);
    END IF;
    CONTINUE WHEN (r.nspname || '.' || r.relname) = ANY (rls_excluded);
    IF r.has_org AND r.has_campus AND r.nspname <> 'iam' THEN
      CALL core.enable_campus_rls(r.tbl);
    ELSIF r.has_org THEN
      CALL core.enable_org_rls(r.tbl);
    END IF;
  END LOOP;
END $$;

-- 3 -----------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  v_redact text[];
  audited text[] := ARRAY[
    -- core / iam / wf
    'core.academic_year','core.calendar_event','core.setting','core.number_sequence',
    'iam.user_account','iam.role','iam.role_permission','iam.role_assignment','wf.approval_request',
    -- admission & students
    'adm.enquiry','adm.application','adm.merit_list','adm.offer',
    'sis.student','sis.guardian','sis.student_guardian','sis.enrolment','sis.student_document','sis.sen_record',
    'sis.profile_change_request','sis.withdrawal',
    -- academics & learning
    'aca.class_section','aca.teaching_group','aca.timetable','aca.substitution',
    'lrn.gradebook_item','lrn.gradebook_score',
    -- exams
    'exm.exam','exm.exam_paper','exm.mark_entry','exm.grading_scheme','exm.grade_band','exm.external_entry',
    'exm.predicted_grade','exm.result_summary',
    -- fees & accounts
    'fee.fee_head','fee.fee_structure','fee.fee_structure_line','fee.student_fee_item','fee.concession_type',
    'fee.student_concession','fee.billing_run','fee.invoice','fee.invoice_line','fee.payment','fee.payment_allocation',
    'fee.receipt','fee.cash_session','fee.gateway_transaction','fee.refund','fee.late_fee_rule',
    'acc.journal','acc.journal_line','acc.fiscal_period',
    -- HR
    'hrm.staff','hrm.contract','hrm.contract_component','hrm.payroll_run','hrm.payslip','hrm.staff_loan',
    'att.staff_leave_request','att.student_leave_request',
    -- communication & documents
    'com.notice','com.broadcast','com.message_template','doc.template','doc.issued_document',
    -- welfare (restricted)
    'hlt.health_profile','hlt.counselling_case','hlt.safeguarding_concern','hlt.behaviour_incident','hlt.bullying_case',
    'sec.pickup_authorisation','inv.transfer','inv.asset'];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    SELECT coalesce(array_agg(attname::text), '{}') INTO v_redact
      FROM pg_attribute
     WHERE attrelid = t::regclass AND attnum > 0 AND NOT attisdropped
       AND (attname LIKE '%\_enc' OR attname IN ('password_hash','token_hash','secret_hash','otp_hash','key_hash'));
    CALL core.enable_audit(t::regclass, v_redact);
  END LOOP;

  -- High-volume tables: audit corrections only (UPDATE/DELETE), never the daily inserts
  CALL core.enable_audit('att.student_daily_attendance', '{}', 'UPDATE OR DELETE');
  CALL core.enable_audit('att.period_attendance',        '{}', 'UPDATE OR DELETE');
  CALL core.enable_audit('att.staff_attendance',         '{}', 'UPDATE OR DELETE');
END $$;
