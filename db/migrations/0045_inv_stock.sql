-- 0045_inv_stock: stores and stock ledger in use (INV-01, INV-02); goods receipts put stock into a store.
-- Run as sms_owner.

-- Purchased lines may be stock items (a variant: size / colour); a goods receipt then names the receiving store.
ALTER TABLE acc.purchase_requisition_line ADD COLUMN item_variant_id uuid REFERENCES inv.item_variant(id);
ALTER TABLE acc.purchase_order_line       ADD COLUMN item_variant_id uuid REFERENCES inv.item_variant(id);
ALTER TABLE acc.goods_receipt             ADD COLUMN store_id uuid REFERENCES inv.store(id);

-- Stores can be retired; items carry a reorder default.
ALTER TABLE inv.store ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE inv.item  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Issues name who got the goods; every movement keeps the balance after it for the stock card.
ALTER TABLE inv.stock_movement
  ADD COLUMN issued_to   text,
  ADD COLUMN balance_qty numeric(12,3);

-- The ledger is append-only: corrections are new movements (adjustment / write-off), never edits.
REVOKE UPDATE, DELETE, TRUNCATE ON inv.stock_movement FROM sms_app, sms_worker;

-- Balances and reorder rules have no tenant column; RLS reaches them through the store.
ALTER TABLE inv.stock_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY p_stock_balance ON inv.stock_balance
  USING (EXISTS (SELECT 1 FROM inv.store s WHERE s.id = store_id))
  WITH CHECK (EXISTS (SELECT 1 FROM inv.store s WHERE s.id = store_id));
ALTER TABLE inv.stock_level_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_level_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY p_stock_level_rule ON inv.stock_level_rule
  USING (EXISTS (SELECT 1 FROM inv.store s WHERE s.id = store_id))
  WITH CHECK (EXISTS (SELECT 1 FROM inv.store s WHERE s.id = store_id));

ALTER TABLE inv.item_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_variant FORCE ROW LEVEL SECURITY;
CREATE POLICY p_item_variant ON inv.item_variant
  USING (EXISTS (SELECT 1 FROM inv.item i WHERE i.id = item_id))
  WITH CHECK (EXISTS (SELECT 1 FROM inv.item i WHERE i.id = item_id));

CALL core.enable_audit('inv.item');
CALL core.enable_audit('inv.store');
CALL core.enable_audit('inv.stock_level_rule');

COMMENT ON COLUMN inv.stock_movement.balance_qty IS 'Quantity on hand in the store (variant, batch) right after this movement.';
COMMENT ON COLUMN acc.goods_receipt.store_id IS 'Store that received stock items of the receipt (INV-02).';
