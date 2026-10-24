-- 0042_acc_procurement: budgets with approval and overrun control, requisition -> quotations -> PO -> goods receipt
-- -> supplier bill (VAT / TDS withheld at source) -> payment, vendor performance (ACC-03, ACC-04, ACC-05).
-- Run as sms_owner.

-- Cost centres are the "departments" of a budget; one may stand for an HR department.
ALTER TABLE acc.cost_centre
  ADD COLUMN department_id uuid REFERENCES hrm.department(id),
  ADD COLUMN is_active     boolean NOT NULL DEFAULT true;

-- Budgets: draft -> submitted -> approved (maker-checker) | rejected; a revision supersedes the approved one.
ALTER TABLE acc.budget DROP CONSTRAINT budget_status_check;
ALTER TABLE acc.budget
  ADD CONSTRAINT budget_status_check
    CHECK (status IN ('draft','submitted','approved','rejected','superseded','closed')),
  ADD COLUMN revision_of_id uuid REFERENCES acc.budget(id),
  ADD COLUMN submitted_by   uuid,
  ADD COLUMN submitted_at   timestamptz,
  ADD COLUMN decided_by     uuid,
  ADD COLUMN decided_at     timestamptz,
  ADD COLUMN decision_note  text,
  ADD CONSTRAINT budget_maker_checker CHECK (decided_by IS NULL OR decided_by <> submitted_by);
CREATE UNIQUE INDEX ux_budget_approved ON acc.budget (campus_id, academic_year_id) WHERE status = 'approved';
CREATE INDEX ix_budget_line_account ON acc.budget_line (account_id, cost_centre_id);

-- Requisitions: charged to a cost centre; spending beyond the budget needs an explicit overrun approval.
ALTER TABLE acc.purchase_requisition DROP CONSTRAINT purchase_requisition_status_check;
ALTER TABLE acc.purchase_requisition
  ADD CONSTRAINT purchase_requisition_status_check
    CHECK (status IN ('draft','submitted','approved','rejected','ordered','closed','cancelled')),
  ADD COLUMN title               text,
  ADD COLUMN cost_centre_id      uuid REFERENCES acc.cost_centre(id),
  ADD COLUMN submitted_at        timestamptz,
  ADD COLUMN decided_by          uuid,
  ADD COLUMN decided_at          timestamptz,
  ADD COLUMN decision_note       text,
  ADD COLUMN over_budget         boolean NOT NULL DEFAULT false,
  ADD COLUMN overrun_reason      text,
  ADD COLUMN overrun_approved_by uuid,
  ADD CONSTRAINT pr_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by),
  ADD CONSTRAINT pr_overrun_approved
    CHECK (NOT over_budget OR status NOT IN ('approved','ordered','closed') OR overrun_approved_by IS NOT NULL);
ALTER TABLE acc.purchase_requisition_line
  ADD COLUMN line_no    smallint,
  ADD COLUMN account_id uuid REFERENCES acc.account(id);

-- Quotations: tenant columns (RLS), one per vendor, the reason when the cheapest is not chosen.
ALTER TABLE acc.quotation
  ADD COLUMN org_id           uuid,
  ADD COLUMN campus_id        uuid,
  ADD COLUMN quote_ref        text,
  ADD COLUMN delivery_days    smallint CHECK (delivery_days >= 0),
  ADD COLUMN note             text,
  ADD COLUMN selection_reason text,
  ADD COLUMN created_by       uuid DEFAULT core.current_user_id(),
  ADD COLUMN created_at       timestamptz NOT NULL DEFAULT now();
UPDATE acc.quotation q SET org_id = r.org_id, campus_id = r.campus_id
  FROM acc.purchase_requisition r WHERE r.id = q.requisition_id;
ALTER TABLE acc.quotation ALTER COLUMN org_id SET NOT NULL, ALTER COLUMN campus_id SET NOT NULL;
CREATE UNIQUE INDEX ux_quotation_vendor ON acc.quotation (requisition_id, vendor_id);

-- Purchase orders: from the selected quotation; lines carry the expense account and what was billed.
ALTER TABLE acc.purchase_order
  ADD COLUMN quotation_id     uuid REFERENCES acc.quotation(id),
  ADD COLUMN cost_centre_id   uuid REFERENCES acc.cost_centre(id),
  ADD COLUMN terms            text,
  ADD COLUMN issued_by        uuid,
  ADD COLUMN cancelled_reason text;
CREATE UNIQUE INDEX ux_po_requisition ON acc.purchase_order (requisition_id)
  WHERE requisition_id IS NOT NULL AND status <> 'cancelled';
ALTER TABLE acc.purchase_order_line
  ADD COLUMN line_no    smallint,
  ADD COLUMN account_id uuid REFERENCES acc.account(id),
  ADD COLUMN billed_qty numeric(12,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT po_line_billed CHECK (billed_qty BETWEEN 0 AND received_qty);

-- Goods receipt (GRN) with on-time flag and a rating: the vendor's performance record.
CREATE TABLE acc.goods_receipt (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  grn_no            text NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES acc.purchase_order(id),
  received_on       date NOT NULL,
  received_by       uuid NOT NULL,
  on_time           boolean NOT NULL,
  rating            smallint CHECK (rating BETWEEN 1 AND 5),
  note              text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, grn_no)
);
CREATE INDEX ix_goods_receipt_po ON acc.goods_receipt (purchase_order_id);
CREATE TABLE acc.goods_receipt_line (
  receipt_id uuid NOT NULL REFERENCES acc.goods_receipt(id) ON DELETE CASCADE,
  po_line_id uuid NOT NULL REFERENCES acc.purchase_order_line(id),
  quantity   numeric(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (receipt_id, po_line_id)
);

-- Supplier bills are matched to received, not yet billed quantities (three-way match).
ALTER TABLE acc.supplier_bill
  ADD CONSTRAINT supplier_bill_net CHECK (net_payable_paisa = gross_paisa - vat_paisa - tds_paisa);
CREATE TABLE acc.supplier_bill_line (
  bill_id      uuid NOT NULL REFERENCES acc.supplier_bill(id) ON DELETE CASCADE,
  po_line_id   uuid NOT NULL REFERENCES acc.purchase_order_line(id),
  quantity     numeric(12,3) NOT NULL CHECK (quantity > 0),
  amount_paisa core.paisa_nn NOT NULL,
  PRIMARY KEY (bill_id, po_line_id)
);

CREATE TABLE acc.supplier_payment (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  payment_no       text NOT NULL,
  supplier_bill_id uuid NOT NULL REFERENCES acc.supplier_bill(id),
  vendor_id        uuid NOT NULL REFERENCES acc.vendor(id),
  paid_on          date NOT NULL,
  amount_paisa     core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  method           text NOT NULL CHECK (method IN ('bank','cash','mobile')),
  reference        text,
  journal_id       uuid REFERENCES acc.journal(id),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, payment_no)
);
CREATE INDEX ix_supplier_payment_bill ON acc.supplier_payment (supplier_bill_id);

CALL core.enable_campus_rls('acc.quotation');
CALL core.enable_campus_rls('acc.goods_receipt');
CALL core.enable_campus_rls('acc.supplier_payment');
CALL core.enable_touch('acc.goods_receipt');
CALL core.enable_touch('acc.supplier_payment');
CALL core.enable_audit('acc.budget');
CALL core.enable_audit('acc.budget_line');
CALL core.enable_audit('acc.vendor');
CALL core.enable_audit('acc.purchase_requisition');
CALL core.enable_audit('acc.quotation');
CALL core.enable_audit('acc.purchase_order');
CALL core.enable_audit('acc.goods_receipt');
CALL core.enable_audit('acc.supplier_bill');
CALL core.enable_audit('acc.supplier_payment');

COMMENT ON TABLE acc.goods_receipt IS 'Goods received against a purchase order (GRN), with on-time flag and rating. [ACC-04, ACC-05]';
COMMENT ON TABLE acc.supplier_bill_line IS 'Billed quantity per PO line; never more than received and not yet billed (three-way match).';
COMMENT ON TABLE acc.supplier_payment IS 'Payment of a supplier bill; posts Dr accounts payable, Cr bank / cash. [ACC-04]';
