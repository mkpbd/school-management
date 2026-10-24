import { randomUUID } from 'node:crypto';
import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  assertAvailable,
  assertQuantity,
  countAdjustment,
  isLow,
  round3,
  signedDelta,
  type MovementType,
} from '../domain/stock.js';

export type ItemCategory =
  | 'uniform'
  | 'book'
  | 'stationery'
  | 'lab_consumable'
  | 'lab_equipment'
  | 'ict'
  | 'cleaning'
  | 'furniture'
  | 'sports'
  | 'other';

export interface VariantRow {
  id: string;
  itemId: string;
  code: string;
  attributes: Record<string, string>;
  barcode: string | null;
  salePricePaisa: number | null;
}

export interface ItemRow {
  id: string;
  sku: string;
  nameEn: string;
  nameBn: string | null;
  category: ItemCategory;
  unit: string;
  isSellable: boolean;
  barcode: string | null;
  isActive: boolean;
  variants?: VariantRow[];
}

export interface StoreRow {
  id: string;
  campusId: string;
  code: string;
  name: string;
  kind: 'central' | 'uniform_shop' | 'book_shop' | 'lab' | 'ict' | 'sports';
  keeperStaffId: string | null;
  isActive: boolean;
}

export interface StockRow {
  variantId: string;
  itemId: string;
  sku: string;
  itemName: string;
  variantCode: string;
  category: ItemCategory;
  unit: string;
  onHand: number;
  avgCostPaisa: number;
  valuePaisa: number;
  minQty: number | null;
  maxQty: number | null;
  low: boolean;
}

export interface MovementRow {
  id: number;
  variantId: string;
  sku: string;
  itemName: string;
  variantCode: string;
  movementType: MovementType;
  qtyDelta: number;
  balanceQty: number | null;
  unitCostPaisa: number | null;
  refType: string | null;
  refId: string | null;
  issuedTo: string | null;
  reason: string | null;
  movedBy: string;
  movedAt: Date;
}

export interface NewMovement {
  orgId: string;
  campusId: string;
  storeId: string;
  variantId: string;
  type: MovementType;
  delta: number;
  balanceQty: number;
  unitCostPaisa: number | null;
  refType?: string | null;
  refId?: string | null;
  transferId?: string | null;
  issuedTo?: string | null;
  reason?: string | null;
  movedBy: string;
}

export interface InvRepository {
  insertItem(values: Record<string, unknown>): Promise<string>;
  updateItem(id: string, patch: Record<string, unknown>): Promise<void>;
  item(id: string): Promise<ItemRow | null>;
  items(f: { q?: string; category?: string; active?: boolean }): Promise<ItemRow[]>;
  insertVariants(itemId: string, rows: Array<Record<string, unknown>>): Promise<void>;
  variantsWithItems(
    ids: string[],
  ): Promise<
    Map<
      string,
      { id: string; itemId: string; sku: string; name: string; code: string; unit: string; isActive: boolean }
    >
  >;
  insertStore(values: Record<string, unknown>): Promise<string>;
  updateStore(id: string, patch: Record<string, unknown>): Promise<void>;
  store(id: string): Promise<StoreRow | null>;
  stores(campusId?: string | null): Promise<StoreRow[]>;
  /** locks the store (movements are serialised per store) and reads its balances; missing rows read as 0 */
  lockBalances(storeId: string, variantIds: string[]): Promise<Map<string, { onHand: number; avgCostPaisa: number }>>;
  insertMovements(rows: NewMovement[]): Promise<void>;
  stock(storeId: string, f: { q?: string; lowOnly?: boolean }): Promise<StockRow[]>;
  movements(storeId: string, f: { variantId?: string; from?: Date; to?: Date; limit: number }): Promise<MovementRow[]>;
  setLevel(storeId: string, variantId: string, minQty: number, maxQty: number | null): Promise<void>;
  insertTransfer(values: Record<string, unknown>): Promise<string>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  invRepo: InvRepository;
  scopePolicy: ScopePolicy;
}

async function visibleStore(d: Pick<Deps, 'invRepo' | 'scopePolicy'>, id: string): Promise<StoreRow> {
  const s = await d.invRepo.store(id);
  if (!s) throw new NotFoundError('Store not found', 'STORE_NOT_FOUND');
  d.scopePolicy.requireCampus(s.campusId);
  return s;
}

/**
 * Posts movements to one store: locks the balances, refuses negative stock, stamps the balance after each line and
 * the cost (receipts at their price, outward lines at the average cost). The DB trigger keeps stock_balance.
 */
export async function postMovements(
  d: Pick<Deps, 'invRepo' | 'ctx'>,
  store: StoreRow,
  type: MovementType,
  lines: Array<{ variantId: string; qty: number; unitCostPaisa?: number | null }>,
  extra: { refType?: string; refId?: string; transferId?: string; issuedTo?: string; reason?: string } = {},
): Promise<number> {
  if (!store.isActive) throw new InvariantError('STORE_INACTIVE', `Store ${store.code} is closed`);
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length)
    throw new InvariantError('DUPLICATE_LINE', 'An item appears twice');
  const variants = await d.invRepo.variantsWithItems(lines.map((l) => l.variantId));
  const balances = await d.invRepo.lockBalances(
    store.id,
    lines.map((l) => l.variantId),
  );
  const rows: NewMovement[] = [];
  for (const l of lines) {
    const v = variants.get(l.variantId);
    if (!v) throw new InvariantError('ITEM_UNKNOWN', 'Unknown item variant');
    if (type !== 'adjustment') assertQuantity(l.qty);
    const delta = round3(signedDelta(type, l.qty));
    if (delta === 0) continue;
    if (delta > 0 && !v.isActive && type === 'receipt')
      throw new InvariantError('ITEM_INACTIVE', `${v.sku} is no longer stocked`);
    const bal = balances.get(l.variantId) ?? { onHand: 0, avgCostPaisa: 0 };
    if (delta < 0) assertAvailable(bal.onHand, delta, `${v.sku} ${v.code}`);
    rows.push({
      orgId: d.ctx.orgId,
      campusId: store.campusId,
      storeId: store.id,
      variantId: l.variantId,
      type,
      delta,
      balanceQty: round3(bal.onHand + delta),
      unitCostPaisa: delta > 0 ? (l.unitCostPaisa ?? null) : bal.avgCostPaisa,
      refType: extra.refType ?? null,
      refId: extra.refId ?? null,
      transferId: extra.transferId ?? null,
      issuedTo: extra.issuedTo ?? null,
      reason: extra.reason ?? null,
      movedBy: d.ctx.userId!,
    });
  }
  await d.invRepo.insertMovements(rows);
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Items and stores
// ---------------------------------------------------------------------------------------------------------------

export interface VariantInput {
  code: string;
  attributes?: Record<string, string>;
  barcode?: string | null;
  salePricePaisa?: number | null;
}

/** Item master (org-wide); without variants it gets one standard variant "STD". */
export class CreateItem extends UseCase<
  {
    sku: string;
    nameEn: string;
    nameBn?: string | null;
    category: ItemCategory;
    unit: string;
    isSellable?: boolean;
    barcode?: string | null;
    variants?: VariantInput[];
  },
  ItemRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    sku: string;
    nameEn: string;
    nameBn?: string | null;
    category: ItemCategory;
    unit: string;
    isSellable?: boolean;
    barcode?: string | null;
    variants?: VariantInput[];
  }) {
    const variants = i.variants?.length ? i.variants : [{ code: 'STD' }];
    if (new Set(variants.map((v) => v.code.toUpperCase())).size !== variants.length)
      throw new InvariantError('DUPLICATE_VARIANT', 'Variant codes must be unique');
    const id = await this.d.invRepo.insertItem({
      orgId: this.d.ctx.orgId,
      sku: i.sku.toUpperCase(),
      nameEn: i.nameEn,
      nameBn: i.nameBn ?? null,
      category: i.category,
      unit: i.unit,
      isSellable: i.isSellable ?? false,
      barcode: i.barcode ?? null,
    });
    await this.d.invRepo.insertVariants(id, variants.map(variantValues));
    return (await this.d.invRepo.item(id))!;
  }
}

const variantValues = (v: VariantInput) => ({
  code: v.code.toUpperCase(),
  attributes: v.attributes ?? {},
  barcode: v.barcode ?? null,
  salePricePaisa: v.salePricePaisa ?? null,
});

export class UpdateItem extends UseCase<
  {
    id: string;
    nameEn?: string;
    nameBn?: string | null;
    unit?: string;
    isSellable?: boolean;
    barcode?: string | null;
    isActive?: boolean;
  },
  ItemRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id, ...patch }: { id: string } & Record<string, unknown>) {
    if (!(await this.d.invRepo.item(id))) throw new NotFoundError('Item not found', 'ITEM_NOT_FOUND');
    await this.d.invRepo.updateItem(id, patch);
    return (await this.d.invRepo.item(id))!;
  }
}

export class AddVariants extends UseCase<{ itemId: string; variants: VariantInput[] }, ItemRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { itemId: string; variants: VariantInput[] }) {
    if (!(await this.d.invRepo.item(i.itemId))) throw new NotFoundError('Item not found', 'ITEM_NOT_FOUND');
    await this.d.invRepo.insertVariants(i.itemId, i.variants.map(variantValues));
    return (await this.d.invRepo.item(i.itemId))!;
  }
}

export class ListItems extends Query<{ q?: string; category?: string; active?: boolean }, ItemRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { q?: string; category?: string; active?: boolean }) {
    return this.d.invRepo.items(i);
  }
}

export class GetItem extends Query<{ id: string }, ItemRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const item = await this.d.invRepo.item(id);
    if (!item) throw new NotFoundError('Item not found', 'ITEM_NOT_FOUND');
    return item;
  }
}

export class CreateStore extends UseCase<
  { campusId?: string; code: string; name: string; kind: StoreRow['kind']; keeperStaffId?: string | null },
  StoreRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    campusId?: string;
    code: string;
    name: string;
    kind: StoreRow['kind'];
    keeperStaffId?: string | null;
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const id = await this.d.invRepo.insertStore({
      orgId: this.d.ctx.orgId,
      campusId,
      code: i.code.toUpperCase(),
      name: i.name,
      kind: i.kind,
      keeperStaffId: i.keeperStaffId ?? null,
    });
    return (await this.d.invRepo.store(id))!;
  }
}

export class UpdateStore extends UseCase<
  { id: string; name?: string; keeperStaffId?: string | null; isActive?: boolean },
  StoreRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({
    id,
    ...patch
  }: {
    id: string;
    name?: string;
    keeperStaffId?: string | null;
    isActive?: boolean;
  }) {
    await visibleStore(this.d, id);
    await this.d.invRepo.updateStore(id, patch);
    return (await this.d.invRepo.store(id))!;
  }
}

export class ListStores extends Query<Record<string, never>, StoreRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.invRepo.stores(this.d.ctx.activeCampusId);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------------------------

export class GetStock extends Query<
  { storeId: string; q?: string; lowOnly?: boolean },
  { store: StoreRow; rows: StockRow[]; totalValuePaisa: number; lowCount: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { storeId: string; q?: string; lowOnly?: boolean }) {
    const store = await visibleStore(this.d, i.storeId);
    const rows = (await this.d.invRepo.stock(store.id, { q: i.q })).map((r) => ({
      ...r,
      low: isLow(r.onHand, r.minQty),
    }));
    const shown = i.lowOnly ? rows.filter((r) => r.low) : rows;
    return {
      store,
      rows: shown,
      totalValuePaisa: rows.reduce((s, r) => s + r.valuePaisa, 0),
      lowCount: rows.filter((r) => r.low).length,
    };
  }
}

export class ListMovements extends Query<
  { storeId: string; variantId?: string; from?: string; to?: string },
  MovementRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { storeId: string; variantId?: string; from?: string; to?: string }) {
    const store = await visibleStore(this.d, i.storeId);
    return this.d.invRepo.movements(store.id, {
      variantId: i.variantId,
      from: i.from ? new Date(`${i.from}T00:00:00+06:00`) : undefined,
      to: i.to ? new Date(`${i.to}T23:59:59.999+06:00`) : undefined,
      limit: 1000,
    });
  }
}

/** Opening balance or a receipt without a purchase order (donation, return from a department). */
export class ReceiveStock extends UseCase<
  {
    storeId: string;
    kind: 'opening' | 'receipt';
    reason?: string;
    lines: Array<{ variantId: string; qty: number; unitCostPaisa: number }>;
  },
  { movements: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    storeId: string;
    kind: 'opening' | 'receipt';
    reason?: string;
    lines: Array<{ variantId: string; qty: number; unitCostPaisa: number }>;
  }) {
    const store = await visibleStore(this.d, i.storeId);
    return { movements: await postMovements(this.d, store, i.kind, i.lines, { reason: i.reason }) };
  }
}

/** Issue note: goods handed to a department / person; never more than on hand. */
export class IssueStock extends UseCase<
  { storeId: string; issuedTo: string; reason?: string; lines: Array<{ variantId: string; qty: number }> },
  { movements: number; issueId: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    storeId: string;
    issuedTo: string;
    reason?: string;
    lines: Array<{ variantId: string; qty: number }>;
  }) {
    const store = await visibleStore(this.d, i.storeId);
    const issueId = randomUUID();
    const movements = await postMovements(this.d, store, 'issue', i.lines, {
      refType: 'issue_note',
      refId: issueId,
      issuedTo: i.issuedTo,
      reason: i.reason,
    });
    return { movements, issueId };
  }
}

/** Store to store (same organisation, campuses the user can reach): out and in in one transaction, at cost. */
export class TransferStock extends UseCase<
  { fromStoreId: string; toStoreId: string; reason?: string; lines: Array<{ variantId: string; qty: number }> },
  { transferId: string; movements: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    fromStoreId: string;
    toStoreId: string;
    reason?: string;
    lines: Array<{ variantId: string; qty: number }>;
  }) {
    if (i.fromStoreId === i.toStoreId) throw new InvariantError('SAME_STORE', 'Choose two different stores');
    const from = await visibleStore(this.d, i.fromStoreId);
    const to = await visibleStore(this.d, i.toStoreId);
    const transferId = await this.d.invRepo.insertTransfer({
      orgId: this.d.ctx.orgId,
      campusId: from.campusId,
      fromStoreId: from.id,
      toStoreId: to.id,
      status: 'received',
      lines: i.lines,
    });
    const costs = await this.d.invRepo.lockBalances(
      from.id,
      i.lines.map((l) => l.variantId),
    );
    const out = await postMovements(this.d, from, 'transfer_out', i.lines, {
      transferId,
      refType: 'transfer',
      refId: transferId,
      reason: i.reason,
    });
    const inn = await postMovements(
      this.d,
      to,
      'transfer_in',
      i.lines.map((l) => ({ ...l, unitCostPaisa: costs.get(l.variantId)?.avgCostPaisa ?? 0 })),
      { transferId, refType: 'transfer', refId: transferId, reason: i.reason },
    );
    return { transferId, movements: out + inn };
  }
}

/** Stock count: counted quantities replace the book quantities (adjustment movements for the differences). */
export class AdjustStock extends UseCase<
  { storeId: string; reason: string; lines: Array<{ variantId: string; countedQty: number }> },
  { movements: number; differences: Array<{ variantId: string; delta: number }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    storeId: string;
    reason: string;
    lines: Array<{ variantId: string; countedQty: number }>;
  }) {
    const store = await visibleStore(this.d, i.storeId);
    const book = await this.d.invRepo.lockBalances(
      store.id,
      i.lines.map((l) => l.variantId),
    );
    const differences = i.lines
      .map((l) => ({
        variantId: l.variantId,
        delta: countAdjustment(book.get(l.variantId)?.onHand ?? 0, l.countedQty),
      }))
      .filter((x) => x.delta !== 0);
    const movements = await postMovements(
      this.d,
      store,
      'adjustment',
      differences.map((x) => ({
        variantId: x.variantId,
        qty: x.delta,
        unitCostPaisa: book.get(x.variantId)?.avgCostPaisa,
      })),
      { reason: i.reason, refType: 'stock_count' },
    );
    return { movements, differences };
  }
}

export class SetReorderLevel extends UseCase<
  { storeId: string; variantId: string; minQty: number; maxQty?: number | null },
  { storeId: string; variantId: string; minQty: number; maxQty: number | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { storeId: string; variantId: string; minQty: number; maxQty?: number | null }) {
    const store = await visibleStore(this.d, i.storeId);
    if (i.maxQty !== undefined && i.maxQty !== null && i.maxQty < i.minQty)
      throw new InvariantError('LEVEL_INVALID', 'Maximum is below the minimum');
    if (!(await this.d.invRepo.variantsWithItems([i.variantId])).size)
      throw new InvariantError('ITEM_UNKNOWN', 'Unknown item variant');
    await this.d.invRepo.setLevel(store.id, i.variantId, i.minQty, i.maxQty ?? null);
    return { storeId: store.id, variantId: i.variantId, minQty: i.minQty, maxQty: i.maxQty ?? null };
  }
}
