-- 0046_inv_balance_trigger_fix: outward stock movements were always rejected.
-- Run as sms_owner.
--
-- tg_apply_movement upserted with INSERT ... ON CONFLICT DO UPDATE. PostgreSQL checks CHECK constraints on the row
-- proposed for insertion before resolving the conflict, so a negative qty_delta (issue, sale, transfer out) failed
-- "qty_on_hand >= 0" even when enough stock was on hand. Update the balance first; insert only when there is none.
-- Negative stock is still impossible: the UPDATE (or the first INSERT of a negative row) violates the same CHECK.

CREATE OR REPLACE FUNCTION inv.tg_apply_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, inv AS $$
BEGIN
  UPDATE inv.stock_balance b
     SET qty_on_hand    = b.qty_on_hand + NEW.qty_delta,
         avg_cost_paisa = CASE WHEN NEW.qty_delta > 0 AND NEW.unit_cost_paisa IS NOT NULL
                               THEN round((b.qty_on_hand * b.avg_cost_paisa + NEW.qty_delta * NEW.unit_cost_paisa)
                                          / nullif(b.qty_on_hand + NEW.qty_delta, 0))
                               ELSE b.avg_cost_paisa END
   WHERE b.store_id = NEW.store_id AND b.item_variant_id = NEW.item_variant_id AND b.batch_no = NEW.batch_no;
  IF NOT FOUND THEN
    INSERT INTO inv.stock_balance (store_id, item_variant_id, batch_no, qty_on_hand, avg_cost_paisa)
    VALUES (NEW.store_id, NEW.item_variant_id, NEW.batch_no, NEW.qty_delta, coalesce(NEW.unit_cost_paisa, 0));
  END IF;
  RETURN NULL;
END $$;
