-- 0020_acc: chart of accounts, double-entry journals, budgets, vendors, procurement (ACC-01..06)

CREATE TABLE acc.account (                         -- ACC-01 chart of accounts (tree)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  code        text NOT NULL,                       -- '4100'
  name_en     text NOT NULL,
  name_bn     text,
  kind        text NOT NULL CHECK (kind IN ('asset','liability','equity','income','expense')),
  parent_id   uuid REFERENCES acc.account(id),
  is_postable boolean NOT NULL DEFAULT true,       -- false for group/header accounts
  is_bank     boolean NOT NULL DEFAULT false,
  is_cash     boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE acc.cost_centre (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  campus_id uuid REFERENCES core.campus(id),
  code      text NOT NULL,
  name_en   text NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE acc.fiscal_period (                   -- period lock
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  code       text NOT NULL,                        -- '2026-11'
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_locked','locked')),
  locked_by  uuid,
  locked_at  timestamptz,
  UNIQUE (org_id, code),
  EXCLUDE USING gist (org_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE TABLE acc.journal (                         -- receipt / payment / journal / contra vouchers
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid NOT NULL,
  journal_no     text NOT NULL,
  voucher_type   text NOT NULL CHECK (voucher_type IN ('receipt','payment','journal','contra')),
  journal_date   date NOT NULL,
  fiscal_period_id uuid NOT NULL REFERENCES acc.fiscal_period(id),
  narration      text NOT NULL,
  source_module  text,                             -- 'fee','hrm','inv' (auto-posted) or NULL (manual)
  source_type    text,
  source_id      text,
  status         text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','pending_approval','posted')),
  reversal_of_id uuid UNIQUE REFERENCES acc.journal(id),   -- reversing journal (never edit posted)
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, journal_no)
);
CREATE UNIQUE INDEX ux_journal_source ON acc.journal (source_module, source_type, source_id)
  WHERE source_id IS NOT NULL AND reversal_of_id IS NULL;      -- auto-postings are idempotent

CREATE TABLE acc.journal_line (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id      uuid NOT NULL REFERENCES acc.journal(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  account_id      uuid NOT NULL REFERENCES acc.account(id),
  cost_centre_id  uuid REFERENCES acc.cost_centre(id),
  party_type      text CHECK (party_type IN ('family','vendor','staff')),
  party_id        uuid,
  debit_paisa     core.paisa_nn NOT NULL DEFAULT 0,
  credit_paisa    core.paisa_nn NOT NULL DEFAULT 0,
  memo            text,
  CHECK ((debit_paisa = 0) <> (credit_paisa = 0))          -- exactly one side
);
CREATE INDEX ix_journal_line_account ON acc.journal_line (account_id, journal_id);
CREATE INDEX ix_journal_line_party ON acc.journal_line (party_type, party_id) WHERE party_id IS NOT NULL;

-- Balanced journals and period lock, checked at COMMIT (deferred) so lines can be inserted one by one.
CREATE FUNCTION acc.tg_journal_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, acc AS $$
DECLARE
  v_journal uuid := coalesce(NEW.journal_id, OLD.journal_id);
  v_dr bigint; v_cr bigint; v_status text; v_period text;
BEGIN
  SELECT j.status, p.status INTO v_status, v_period
    FROM acc.journal j JOIN acc.fiscal_period p ON p.id = j.fiscal_period_id WHERE j.id = v_journal;
  IF NOT FOUND OR v_status <> 'posted' THEN RETURN NULL; END IF;
  IF v_period = 'locked' THEN
    RAISE EXCEPTION 'fiscal period is locked for journal %', v_journal USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(debit_paisa), 0), coalesce(sum(credit_paisa), 0) INTO v_dr, v_cr
    FROM acc.journal_line WHERE journal_id = v_journal;
  IF v_dr <> v_cr OR v_dr = 0 THEN
    RAISE EXCEPTION 'journal % is not balanced (Dr % <> Cr %)', v_journal, v_dr, v_cr USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON acc.journal_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc.tg_journal_balanced();

CREATE TABLE acc.budget (                          -- ACC-03 (P3)
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','closed')),
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE TABLE acc.budget_line (
  budget_id       uuid NOT NULL REFERENCES acc.budget(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES acc.account(id),
  cost_centre_id  uuid REFERENCES acc.cost_centre(id),
  month_no        smallint NOT NULL CHECK (month_no BETWEEN 1 AND 12),
  amount_paisa    core.paisa_nn NOT NULL,
  UNIQUE NULLS NOT DISTINCT (budget_id, account_id, cost_centre_id, month_no)
);

CREATE TABLE acc.vendor (                          -- ACC-05 (P3)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  code          text NOT NULL,
  name          text NOT NULL,
  phone         core.phone_e164,
  email         citext,
  address       text,
  tin           text,
  bin_vat       text,
  tds_rate_pct  numeric(5,2),
  vat_rate_pct  numeric(5,2),
  payment_terms_days smallint NOT NULL DEFAULT 30,
  performance_note text,
  is_active     boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE acc.purchase_requisition (            -- ACC-04 (P3)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  pr_no         text NOT NULL,
  department_id uuid REFERENCES hrm.department(id),
  requested_by  uuid NOT NULL,
  needed_by     date,
  justification text,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','approved','rejected','ordered','closed')),
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, pr_no)
);
CREATE TABLE acc.purchase_requisition_line (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  requisition_id uuid NOT NULL REFERENCES acc.purchase_requisition(id) ON DELETE CASCADE,
  item_id        uuid,                             -- inv.item
  description    text NOT NULL,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  est_unit_paisa core.paisa_nn
);

CREATE TABLE acc.quotation (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  requisition_id uuid NOT NULL REFERENCES acc.purchase_requisition(id),
  vendor_id      uuid NOT NULL REFERENCES acc.vendor(id),
  total_paisa    core.paisa_nn NOT NULL,
  valid_until    date,
  file_id        uuid REFERENCES sys.stored_file(id),
  is_selected    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ux_quotation_selected ON acc.quotation (requisition_id) WHERE is_selected;

CREATE TABLE acc.purchase_order (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid NOT NULL,
  po_no          text NOT NULL,
  vendor_id      uuid NOT NULL REFERENCES acc.vendor(id),
  requisition_id uuid REFERENCES acc.purchase_requisition(id),
  order_date     date NOT NULL,
  expected_on    date,
  total_paisa    core.paisa_nn NOT NULL,
  status         text NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('draft','issued','partially_received','received','billed','closed','cancelled')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, po_no)
);
CREATE TABLE acc.purchase_order_line (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  purchase_order_id uuid NOT NULL REFERENCES acc.purchase_order(id) ON DELETE CASCADE,
  item_id        uuid,
  description    text NOT NULL,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_paisa     core.paisa_nn NOT NULL,
  received_qty   numeric(12,3) NOT NULL DEFAULT 0,
  CHECK (received_qty BETWEEN 0 AND quantity)
);

CREATE TABLE acc.supplier_bill (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  vendor_id         uuid NOT NULL REFERENCES acc.vendor(id),
  purchase_order_id uuid REFERENCES acc.purchase_order(id),
  bill_no           text NOT NULL,
  bill_date         date NOT NULL,
  due_date          date NOT NULL,
  gross_paisa       core.paisa_nn NOT NULL,
  vat_paisa         core.paisa_nn NOT NULL DEFAULT 0,
  tds_paisa         core.paisa_nn NOT NULL DEFAULT 0,
  net_payable_paisa core.paisa_nn NOT NULL,
  paid_paisa        core.paisa_nn NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','cancelled')),
  journal_id        uuid REFERENCES acc.journal(id),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (vendor_id, bill_no),
  CHECK (paid_paisa <= net_payable_paisa)
);

CREATE TABLE acc.connector_mapping (               -- ACC-06 third-party accounting connector
  org_id         uuid NOT NULL,
  source_key     text NOT NULL,                    -- 'fee_head:TUITION', 'payment_channel:bkash', 'salary_component:BASIC'
  campus_id      uuid,
  account_id     uuid REFERENCES acc.account(id),
  external_code  text,                             -- code in the external package
  UNIQUE NULLS NOT DISTINCT (org_id, source_key, campus_id)
);
