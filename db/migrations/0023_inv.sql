-- 0023_inv: items, stores, stock ledger (no negative stock), uniform/book POS, assets, maintenance (INV-01..06)

CREATE TABLE inv.item (                            -- INV-01
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  sku           text NOT NULL,
  name_en       text NOT NULL,
  name_bn       text,
  category      text NOT NULL CHECK (category IN ('uniform','book','stationery','lab_consumable','lab_equipment',
                                                  'ict','cleaning','furniture','sports','other')),
  unit          text NOT NULL DEFAULT 'pcs',
  is_sellable   boolean NOT NULL DEFAULT false,
  track_batch   boolean NOT NULL DEFAULT false,    -- batch/expiry where needed
  barcode       text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, sku)
);

CREATE TABLE inv.item_variant (                    -- uniform size / colour
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id      uuid NOT NULL REFERENCES inv.item(id) ON DELETE CASCADE,
  code         text NOT NULL,                      -- 'S-28', 'M-32'
  attributes   jsonb NOT NULL DEFAULT '{}',        -- {"size":"28","gender":"girls"}
  barcode      text,
  sale_price_paisa core.paisa_nn,
  UNIQUE (item_id, code)
);

CREATE TABLE inv.store (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL REFERENCES core.campus(id),
  code        text NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('central','uniform_shop','book_shop','lab','ict','sports')),
  keeper_staff_id uuid REFERENCES hrm.staff(id),
  UNIQUE (campus_id, code)
);

CREATE TABLE inv.stock_level_rule (                -- min / max reorder levels
  store_id        uuid NOT NULL REFERENCES inv.store(id),
  item_variant_id uuid NOT NULL REFERENCES inv.item_variant(id),
  min_qty         numeric(12,3) NOT NULL DEFAULT 0,
  max_qty         numeric(12,3),
  PRIMARY KEY (store_id, item_variant_id)
);

CREATE TABLE inv.stock_balance (                   -- current quantity; updated only with a ledger insert (same tx)
  store_id        uuid NOT NULL REFERENCES inv.store(id),
  item_variant_id uuid NOT NULL REFERENCES inv.item_variant(id),
  batch_no        text NOT NULL DEFAULT '',
  expires_on      date,
  qty_on_hand     numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),   -- I-9 no negative stock
  avg_cost_paisa  core.paisa_nn NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, item_variant_id, batch_no)
);

CREATE TABLE inv.stock_movement (                  -- INV-02 append-only stock ledger
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  store_id         uuid NOT NULL REFERENCES inv.store(id),
  item_variant_id  uuid NOT NULL REFERENCES inv.item_variant(id),
  batch_no         text NOT NULL DEFAULT '',
  movement_type    text NOT NULL CHECK (movement_type IN ('receipt','issue','transfer_out','transfer_in','sale',
                                                          'sale_return','adjustment','write_off','opening')),
  qty_delta        numeric(12,3) NOT NULL CHECK (qty_delta <> 0),
  unit_cost_paisa  core.paisa_nn,
  ref_type         text,                           -- 'purchase_order','pos_sale','transfer','issue_note'
  ref_id           uuid,
  transfer_id      uuid,                           -- pairs transfer_out/transfer_in
  reason           text,
  moved_by         uuid NOT NULL,
  moved_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_stock_movement_item ON inv.stock_movement (store_id, item_variant_id, moved_at DESC);

-- Apply every movement to the balance; the CHECK on qty_on_hand rejects negative stock atomically.
CREATE FUNCTION inv.tg_apply_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, inv AS $$
BEGIN
  INSERT INTO inv.stock_balance AS b (store_id, item_variant_id, batch_no, qty_on_hand, avg_cost_paisa)
  VALUES (NEW.store_id, NEW.item_variant_id, NEW.batch_no, NEW.qty_delta, coalesce(NEW.unit_cost_paisa, 0))
  ON CONFLICT (store_id, item_variant_id, batch_no) DO UPDATE
     SET qty_on_hand    = b.qty_on_hand + EXCLUDED.qty_on_hand,
         avg_cost_paisa = CASE WHEN EXCLUDED.qty_on_hand > 0 AND NEW.unit_cost_paisa IS NOT NULL
                                THEN round((b.qty_on_hand * b.avg_cost_paisa + EXCLUDED.qty_on_hand * NEW.unit_cost_paisa)
                                           / nullif(b.qty_on_hand + EXCLUDED.qty_on_hand, 0))
                               ELSE b.avg_cost_paisa END;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_apply_movement AFTER INSERT ON inv.stock_movement
  FOR EACH ROW EXECUTE FUNCTION inv.tg_apply_movement();

CREATE TABLE inv.transfer (                        -- inter-campus transfer with approval
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,                   -- source campus
  from_store_id   uuid NOT NULL REFERENCES inv.store(id),
  to_store_id     uuid NOT NULL REFERENCES inv.store(id),
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','dispatched','received','rejected','cancelled')),
  approval_request_id uuid,
  lines           jsonb NOT NULL,                  -- [{variantId, qty, batchNo}] snapshot
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (from_store_id <> to_store_id)
);

CREATE TABLE inv.pos_sale (                        -- INV-03 uniform & book-shop POS
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  store_id      uuid NOT NULL REFERENCES inv.store(id),
  sale_no       text NOT NULL,
  student_id    uuid REFERENCES sis.student(id),
  settlement    text NOT NULL CHECK (settlement IN ('cash','student_account','card','mfs')),
  total_paisa   core.paisa_nn NOT NULL,
  invoice_id    uuid REFERENCES fee.invoice(id),   -- when charged to student account
  payment_id    uuid REFERENCES fee.payment(id),   -- when paid immediately
  sold_by       uuid NOT NULL,
  sold_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','returned','partially_returned','void')),
  UNIQUE (org_id, sale_no)
);
CREATE TABLE inv.pos_sale_line (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  pos_sale_id     uuid NOT NULL REFERENCES inv.pos_sale(id) ON DELETE CASCADE,
  item_variant_id uuid NOT NULL REFERENCES inv.item_variant(id),
  qty             numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price_paisa core.paisa_nn NOT NULL,
  discount_paisa  core.paisa_nn NOT NULL DEFAULT 0,
  returned_qty    numeric(12,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  CHECK (returned_qty <= qty)
);

CREATE TABLE inv.bundle (                          -- uniform / book sets per class
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  name          text NOT NULL,
  year_group_id uuid REFERENCES aca.year_group(id),
  items         jsonb NOT NULL                     -- [{itemId, qty}] — size chosen at sale
);

CREATE TABLE inv.asset (                           -- INV-04 (P3) fixed-asset register
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  asset_tag         text NOT NULL,                 -- printed as QR
  name              text NOT NULL,
  category          text NOT NULL,
  room_id           uuid REFERENCES core.room(id),
  custodian_staff_id uuid REFERENCES hrm.staff(id),
  purchase_date     date,
  cost_paisa        core.paisa_nn,
  salvage_paisa     core.paisa_nn NOT NULL DEFAULT 0,
  useful_life_months smallint,
  depreciation_method text NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line','declining','none')),
  vendor_id         uuid REFERENCES acc.vendor(id),
  warranty_until    date,
  status            text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','in_store','under_repair','disposed','lost')),
  disposed_on       date,
  disposal_note     text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, asset_tag)
);

CREATE TABLE inv.asset_event (                     -- movements, verification, maintenance history
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id    uuid NOT NULL REFERENCES inv.asset(id),
  kind        text NOT NULL CHECK (kind IN ('moved','custodian_changed','verified','maintained','disposed')),
  details     jsonb NOT NULL DEFAULT '{}',
  actor_id    uuid NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inv.maintenance_ticket (              -- INV-06 (P3) facility / IT tickets with SLA
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  ticket_no     text NOT NULL,
  category      text NOT NULL CHECK (category IN ('electrical','plumbing','it','furniture','cleaning','ac','other')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  title         text NOT NULL,
  description   text,
  room_id       uuid REFERENCES core.room(id),
  asset_id      uuid REFERENCES inv.asset(id),
  photo_file_ids uuid[] NOT NULL DEFAULT '{}',
  raised_by     uuid NOT NULL,
  assignee_id   uuid,
  sla_due_at    timestamptz,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','done','signed_off','cancelled')),
  completed_at  timestamptz,
  signed_off_by uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, ticket_no)
);
