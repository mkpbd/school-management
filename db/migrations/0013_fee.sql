-- 0013_fee: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE fee.fee_head (                        -- FEE-01
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  code          text NOT NULL,                     -- TUITION, ADMISSION, SESSION, EXAM, LAB, TRANSPORT, ACTIVITY,
                                                   -- UNIFORM, EDEXCEL_ENTRY, LATE_FINE, LIB_FINE, ID_CARD, OPENING_BAL
  name_en       text NOT NULL,
  name_bn       text,
  kind          text NOT NULL CHECK (kind IN ('tuition','admission','session','exam','lab','transport','activity',
                                              'uniform','external_exam','fine','service','opening_balance','misc')),
  frequency     text NOT NULL CHECK (frequency IN ('one_time','monthly','termly','annual','on_demand')),
  is_refundable boolean NOT NULL DEFAULT false,
  is_discountable boolean NOT NULL DEFAULT true,
  gl_income_account_code text,                     -- ACC mapping
  priority      smallint NOT NULL DEFAULT 100,     -- allocation order (fines first, tuition last...)
  is_active     boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE fee.fee_structure (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  year_group_id    uuid NOT NULL REFERENCES aca.year_group(id),
  name             text NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_fee_structure_active ON fee.fee_structure (campus_id, academic_year_id, year_group_id)
  WHERE status = 'active';

CREATE TABLE fee.fee_structure_line (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  fee_structure_id uuid NOT NULL REFERENCES fee.fee_structure(id) ON DELETE CASCADE,
  fee_head_id      uuid NOT NULL REFERENCES fee.fee_head(id),
  amount_paisa     core.paisa_nn NOT NULL,
  billing_months   smallint[],                     -- {1..12} month numbers of the academic year; NULL = one-time
  due_day          smallint NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  applies_to       text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','new_admission','continuing')),
  UNIQUE (fee_structure_id, fee_head_id)
);

CREATE TABLE fee.student_fee_item (                -- extra/conditional heads per enrolment (transport, activity, lab)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  enrolment_id  uuid NOT NULL REFERENCES sis.enrolment(id),
  fee_head_id   uuid NOT NULL REFERENCES fee.fee_head(id),
  amount_paisa  core.paisa_nn NOT NULL,
  billing_months smallint[],
  valid_from    date NOT NULL,
  valid_to      date,
  source_module text NOT NULL,                     -- 'trn','cca','fee'
  source_ref    uuid,                              -- e.g. trn.transport_assignment.id
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE TABLE fee.concession_type (                 -- FEE-02
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  code              text NOT NULL,                 -- SIBLING, STAFF_WARD, MERIT, NEED, SPECIAL
  name_en           text NOT NULL,
  calc              text NOT NULL CHECK (calc IN ('percent','amount')),
  default_value     numeric(12,2) NOT NULL,
  applies_to_head_ids uuid[] NOT NULL,             -- usually {TUITION}
  stacking          text NOT NULL DEFAULT 'best_of' CHECK (stacking IN ('best_of','additive','exclusive')),
  max_percent_cap   core.percent,
  requires_approval boolean NOT NULL DEFAULT true,
  auto_rule         jsonb,                         -- {"sibling_rank_gte": 2} for automatic sibling discount
  UNIQUE (org_id, code)
);

CREATE TABLE fee.student_concession (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  student_id         uuid NOT NULL REFERENCES sis.student(id),
  concession_type_id uuid NOT NULL REFERENCES fee.concession_type(id),
  fee_head_id        uuid REFERENCES fee.fee_head(id),     -- NULL => type default heads
  value_percent      core.percent,
  value_paisa        core.paisa_nn,
  valid_from         date NOT NULL,
  valid_to           date NOT NULL,                        -- renewal rule: must be re-approved yearly
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','expired','revoked')),
  approval_request_id uuid,
  justification      text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK ((value_percent IS NULL) <> (value_paisa IS NULL)),
  CHECK (valid_to >= valid_from)
);  -- std(audit, rls)

CREATE TABLE fee.billing_run (                     -- FEE-03 bulk invoices with preview
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  billing_period   text NOT NULL,                  -- '2026-11' (month) or 'T2' (term)
  scope            jsonb NOT NULL DEFAULT '{}',    -- year groups / sections filter
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','previewing','previewed','posting','posted','cancelled')),
  invoice_count    integer,
  total_net_paisa  core.paisa,
  preview_file_id  uuid,
  posted_at        timestamptz,
  posted_by        uuid,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_billing_run_period ON fee.billing_run (campus_id, billing_period) WHERE status <> 'cancelled';

CREATE TABLE fee.invoice (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  invoice_no       text NOT NULL,
  family_id        uuid NOT NULL REFERENCES sis.family(id),
  student_id       uuid REFERENCES sis.student(id),    -- NULL for applicant invoices (application fee)
  enrolment_id     uuid REFERENCES sis.enrolment(id),
  application_id   uuid,                               -- adm.application (pre-enrolment)
  billing_run_id   uuid REFERENCES fee.billing_run(id),
  billing_period   text,
  issue_date       date NOT NULL,
  due_date         date NOT NULL,
  gross_paisa      core.paisa NOT NULL DEFAULT 0,      -- maintained by trigger from lines
  discount_paisa   core.paisa NOT NULL DEFAULT 0,
  net_paisa        core.paisa NOT NULL DEFAULT 0,
  paid_paisa       core.paisa NOT NULL DEFAULT 0,      -- maintained by allocation trigger
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  pay_token        text UNIQUE,                        -- short opaque token for SMS payment link
  void_reason      text,
  voided_at        timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, invoice_no),
  CHECK (paid_paisa >= 0 AND paid_paisa <= greatest(net_paisa, 0)),
  CHECK (due_date >= issue_date),
  CHECK (student_id IS NOT NULL OR application_id IS NOT NULL)
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_invoice_period ON fee.invoice (enrolment_id, billing_period)
  WHERE billing_run_id IS NOT NULL AND status <> 'void';            -- never double-bill a month
CREATE INDEX ix_invoice_family_open ON fee.invoice (family_id) WHERE status IN ('issued','partially_paid');
CREATE INDEX ix_invoice_due ON fee.invoice (campus_id, due_date) WHERE status IN ('issued','partially_paid');
-- "overdue" is derived (due_date < today AND status IN ('issued','partially_paid')), never stored.

CREATE TABLE fee.invoice_line (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  invoice_id      uuid NOT NULL REFERENCES fee.invoice(id),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  fee_head_id     uuid NOT NULL REFERENCES fee.fee_head(id),
  description     text NOT NULL,
  amount_paisa    core.paisa NOT NULL,              -- negative only for source='adjustment'
  discount_paisa  core.paisa_nn NOT NULL DEFAULT 0,
  net_paisa       core.paisa GENERATED ALWAYS AS (amount_paisa - discount_paisa) STORED,
  paid_paisa      core.paisa NOT NULL DEFAULT 0,
  concession_id   uuid REFERENCES fee.student_concession(id),
  source          text NOT NULL CHECK (source IN ('structure','student_item','adhoc','fine','adjustment',
                                                  'library','pos','external_exam','opening_balance')),
  source_ref      text,                             -- idempotency for fines: 'late:{rule}:{stage}'
  priority        smallint NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_paisa >= 0 OR source = 'adjustment'),
  CHECK (discount_paisa <= greatest(amount_paisa, 0)),
  CHECK (paid_paisa >= 0 AND paid_paisa <= greatest(amount_paisa - discount_paisa, 0)),   -- I-5
  UNIQUE (invoice_id, source, source_ref)
);  -- std(audit, rls)
CREATE INDEX ix_invoice_line_invoice ON fee.invoice_line (invoice_id);

CREATE TABLE fee.cash_session (                    -- FEE-05 day-end closing & handover
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  cashier_user_id uuid NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opening_float_paisa core.paisa_nn NOT NULL DEFAULT 0,
  closed_at       timestamptz,
  expected_cash_paisa core.paisa,
  counted_cash_paisa  core.paisa,
  variance_paisa  core.paisa GENERATED ALWAYS AS (counted_cash_paisa - expected_cash_paisa) STORED,
  handed_over_to  uuid,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','verified')),
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_cash_session_open ON fee.cash_session (cashier_user_id) WHERE status = 'open';

CREATE TABLE fee.gateway_transaction (             -- FEE-04 online payment attempt (I-4)
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  provider          text NOT NULL CHECK (provider IN ('sslcommerz','bkash','nagad','aamarpay','bank')),
  merchant_tran_id  text NOT NULL UNIQUE,          -- our id sent to the gateway (idempotency anchor)
  provider_txn_id   text,                          -- gateway's id (bank_tran_id / trxID)
  family_id         uuid NOT NULL,
  initiated_by      uuid NOT NULL,
  amount_paisa      core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  currency          char(3) NOT NULL DEFAULT 'BDT',
  status            text NOT NULL DEFAULT 'initiated'
                    CHECK (status IN ('initiated','redirected','callback_received','validated','failed',
                                      'cancelled','expired','amount_mismatch','refunded')),
  payment_method    text,                          -- 'bkash','visa','nagad' as reported
  init_response     jsonb,
  callback_payload  jsonb,
  validation_payload jsonb,
  validated_at      timestamptz,
  expires_at        timestamptz NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_gateway_provider_txn ON fee.gateway_transaction (provider, provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;
CREATE INDEX ix_gateway_pending ON fee.gateway_transaction (status, expires_at)
  WHERE status IN ('initiated','redirected','callback_received');   -- sweeper re-queries gateway

CREATE TABLE fee.gateway_transaction_invoice (     -- one online payment can settle several invoices (siblings)
  gateway_transaction_id uuid NOT NULL REFERENCES fee.gateway_transaction(id),
  invoice_id             uuid NOT NULL REFERENCES fee.invoice(id),
  amount_paisa           core.paisa_nn NOT NULL,
  PRIMARY KEY (gateway_transaction_id, invoice_id)
);

CREATE TABLE fee.gateway_webhook_log (             -- raw inbound callbacks (forensics, replay protection)
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider         text NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  remote_ip        inet,
  headers          jsonb,
  body             jsonb,
  signature_valid  boolean,
  merchant_tran_id text,
  outcome          text,
  error            text
);

CREATE TABLE fee.payment (                         -- money received (append-only financial effect)
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  payment_no        text NOT NULL,
  family_id         uuid NOT NULL REFERENCES sis.family(id),
  payer_guardian_id uuid REFERENCES sis.guardian(id),
  channel           text NOT NULL CHECK (channel IN ('cash','cheque','pos_card','bank_deposit','bkash','nagad',
                                                     'rocket','card_online','internet_banking','opening_balance')),
  amount_paisa      core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  received_at       timestamptz NOT NULL DEFAULT now(),
  value_date        date NOT NULL DEFAULT current_date,
  status            text NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('pending_clearance','confirmed','bounced','reversed')),
  gateway_transaction_id uuid UNIQUE REFERENCES fee.gateway_transaction(id),   -- duplicate-payment guard
  instrument        jsonb,                         -- cheque no/bank/date, POS ref, deposit slip
  cash_session_id   uuid REFERENCES fee.cash_session(id),
  collected_by      uuid,
  notes             text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, payment_no)
);  -- std(audit, rls)
CREATE INDEX ix_payment_family ON fee.payment (family_id, received_at DESC);
CREATE INDEX ix_payment_daily  ON fee.payment (campus_id, value_date, channel);

CREATE TABLE fee.payment_allocation (              -- payment -> invoice lines (append-only; reversal = negative row)
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                 uuid NOT NULL,
  campus_id              uuid NOT NULL,
  payment_id             uuid NOT NULL REFERENCES fee.payment(id),
  invoice_id             uuid NOT NULL REFERENCES fee.invoice(id),
  invoice_line_id        uuid NOT NULL REFERENCES fee.invoice_line(id),
  amount_paisa           core.paisa NOT NULL CHECK (amount_paisa <> 0),
  reverses_allocation_id bigint UNIQUE REFERENCES fee.payment_allocation(id),
  allocated_at           timestamptz NOT NULL DEFAULT now(),
  allocated_by           uuid,
  CHECK (amount_paisa > 0 OR reverses_allocation_id IS NOT NULL)
);
CREATE INDEX ix_allocation_payment ON fee.payment_allocation (payment_id);
CREATE INDEX ix_allocation_line    ON fee.payment_allocation (invoice_line_id);

CREATE FUNCTION fee.tg_apply_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fee AS $$
BEGIN
  UPDATE fee.invoice_line SET paid_paisa = paid_paisa + NEW.amount_paisa
   WHERE id = NEW.invoice_line_id;                 -- CHECK constraint rejects over-allocation (I-5)
  UPDATE fee.invoice i
     SET paid_paisa = i.paid_paisa + NEW.amount_paisa,
         status = CASE WHEN i.paid_paisa + NEW.amount_paisa >= i.net_paisa THEN 'paid'
                       WHEN i.paid_paisa + NEW.amount_paisa > 0        THEN 'partially_paid'
                       ELSE 'issued' END
   WHERE i.id = NEW.invoice_id AND i.status NOT IN ('void','draft');
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice % is void, draft or missing', NEW.invoice_id USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_apply_allocation AFTER INSERT ON fee.payment_allocation
  FOR EACH ROW EXECUTE FUNCTION fee.tg_apply_allocation();
-- Invoice totals = SUM(lines). Lines may change only while the invoice is a draft;
-- after issue, corrections are new lines (source='adjustment' / 'fine').
CREATE FUNCTION fee.tg_invoice_totals() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fee AS $$
DECLARE
  v_invoice_id uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
  v_status     text;
BEGIN
  SELECT status INTO v_status FROM fee.invoice WHERE id = v_invoice_id FOR UPDATE;
  IF v_status = 'void' THEN
    RAISE EXCEPTION 'invoice % is void', v_invoice_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'lines of issued invoice % are immutable; add an adjustment line instead', v_invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE fee.invoice i
     SET gross_paisa    = s.gross,
         discount_paisa = s.discount,
         net_paisa      = s.net,
         status = CASE WHEN i.status = 'draft'          THEN 'draft'
                       WHEN i.paid_paisa >= s.net        THEN 'paid'
                       WHEN i.paid_paisa > 0             THEN 'partially_paid'
                       ELSE 'issued' END
    FROM (SELECT coalesce(sum(amount_paisa), 0)   AS gross,
                 coalesce(sum(discount_paisa), 0) AS discount,
                 coalesce(sum(net_paisa), 0)      AS net
            FROM fee.invoice_line WHERE invoice_id = v_invoice_id) s
   WHERE i.id = v_invoice_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_invoice_totals
  AFTER INSERT OR DELETE OR UPDATE OF amount_paisa, discount_paisa ON fee.invoice_line
  FOR EACH ROW EXECUTE FUNCTION fee.tg_invoice_totals();

-- Invoice lifecycle guard: issuing a zero-net invoice marks it paid; void only when nothing is paid;
-- financial totals cannot be edited directly (they are trigger-maintained).
CREATE FUNCTION fee.tg_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'invoice % is void and immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'void' AND NEW.paid_paisa > 0 THEN
    RAISE EXCEPTION 'reverse allocations before voiding invoice %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' AND NEW.net_paisa <= NEW.paid_paisa THEN
    NEW.status := 'paid';
  END IF;
  IF NEW.status <> 'void' AND OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'issued invoice % cannot return to draft', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_guard BEFORE UPDATE ON fee.invoice
  FOR EACH ROW EXECUTE FUNCTION fee.tg_invoice_guard();

CREATE TABLE fee.receipt (                         -- FEE-06
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  receipt_no        text NOT NULL,
  payment_id        uuid NOT NULL UNIQUE REFERENCES fee.payment(id),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  file_id           uuid REFERENCES sys.stored_file(id),       -- rendered async
  verification_code text NOT NULL UNIQUE,
  UNIQUE (org_id, receipt_no)
);  -- std(rls)

CREATE TABLE fee.late_fee_rule (                   -- FEE-07
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid,
  applies_to_head_ids uuid[] NOT NULL,
  fine_head_id  uuid NOT NULL REFERENCES fee.fee_head(id),
  grace_days    smallint NOT NULL DEFAULT 0,
  calc          text NOT NULL CHECK (calc IN ('flat','per_day','percent_of_due')),
  value         numeric(12,2) NOT NULL,
  cap_paisa     core.paisa_nn,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE fee.refund (                          -- FEE-08 (P2)
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL,
  family_id           uuid NOT NULL,
  payment_id          uuid REFERENCES fee.payment(id),
  amount_paisa        core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  reason              text NOT NULL,
  mode                text NOT NULL CHECK (mode IN ('cash','cheque','bank_transfer','gateway_reversal','mfs')),
  status              text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  approval_request_id uuid,
  paid_at             timestamptz,
  reference           text,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE VIEW fee.v_family_credit AS                 -- advance / unallocated money per family (FEE-05)
SELECT p.org_id, p.family_id,
       sum(p.amount_paisa) - coalesce(sum(a.allocated), 0) - coalesce(sum(r.refunded), 0) AS credit_paisa
  FROM fee.payment p
  LEFT JOIN LATERAL (SELECT sum(amount_paisa) allocated FROM fee.payment_allocation WHERE payment_id = p.id) a ON true
  LEFT JOIN LATERAL (SELECT sum(amount_paisa) refunded  FROM fee.refund WHERE payment_id = p.id AND status = 'paid') r ON true
 WHERE p.status = 'confirmed'
 GROUP BY p.org_id, p.family_id;

CREATE TABLE fee.settlement_file (                 -- FEE-09 (P2)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  provider        text NOT NULL,
  settlement_date date NOT NULL,
  file_id         uuid NOT NULL REFERENCES sys.stored_file(id),
  row_count       integer,
  imported_by     uuid,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, settlement_date, file_id)
);
CREATE TABLE fee.settlement_line (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  settlement_file_id uuid NOT NULL REFERENCES fee.settlement_file(id) ON DELETE CASCADE,
  provider_txn_id    text NOT NULL,
  gross_paisa        core.paisa NOT NULL,
  fee_paisa          core.paisa NOT NULL DEFAULT 0,
  net_paisa          core.paisa NOT NULL,
  matched_payment_id uuid REFERENCES fee.payment(id),
  match_status       text NOT NULL DEFAULT 'unmatched'
                     CHECK (match_status IN ('matched','unmatched','amount_mismatch','duplicate','resolved')),
  resolved_note      text
);
CREATE INDEX ix_settlement_exceptions ON fee.settlement_line (match_status) WHERE match_status <> 'matched';
