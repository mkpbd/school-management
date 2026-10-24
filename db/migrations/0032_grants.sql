-- 0032_grants: least-privilege grants for runtime roles. Re-runnable; run after every migration batch.

DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
            WHERE nspname IN ('core','iam','audit','wf','sys','search','sis','adm','aca','att','lrn','exm','fee','acc',
                              'hrm','com','prt','doc','web','bi','trn','lib','inv','hlt','cca','sec')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO sms_app, sms_worker, sms_readonly', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO sms_app, sms_worker', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO sms_readonly', s);
    EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO sms_app, sms_worker', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sms_app, sms_worker', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO sms_readonly', s);
  END LOOP;
END $$;

REVOKE ALL ON core.std_cols FROM sms_app, sms_worker, sms_readonly;

-- Append-only tables (I-3): no UPDATE / DELETE for runtime roles.
REVOKE UPDATE, DELETE, TRUNCATE ON
  audit.audit_event, audit.audit_seal,
  exm.mark_entry, exm.paper_status_history,
  fee.payment_allocation, fee.gateway_webhook_log,
  wf.approval_action,
  inv.stock_movement, inv.asset_event,
  cca.house_point,
  hlt.counselling_note, hlt.safeguarding_action,
  sec.pickup_log,
  com.complaint_note
FROM sms_app, sms_worker;

-- Trigger-maintained projections: never written directly by the application.
REVOKE INSERT, UPDATE, DELETE ON exm.mark_current, inv.stock_balance FROM sms_app, sms_worker;

-- Payments are corrected by reversal, never deleted.
REVOKE DELETE ON fee.payment, fee.invoice, fee.receipt, acc.journal, acc.journal_line FROM sms_app, sms_worker;

-- Audit sealer: read audit, write seals only.
GRANT USAGE ON SCHEMA audit TO sms_audit_sealer;
GRANT SELECT ON audit.audit_event TO sms_audit_sealer;
GRANT SELECT, INSERT ON audit.audit_seal TO sms_audit_sealer;

-- Restricted welfare data is not available to the reporting role.
REVOKE SELECT ON hlt.counselling_case, hlt.counselling_note, hlt.safeguarding_concern, hlt.safeguarding_action,
                 sis.sen_record, iam.user_account, iam.refresh_token, iam.otp_challenge
FROM sms_readonly;
