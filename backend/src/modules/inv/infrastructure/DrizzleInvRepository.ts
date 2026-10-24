import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  item,
  itemVariant,
  stockBalance,
  stockLevelRule,
  stockMovement,
  store,
  transfer,
} from '../../../shared/infrastructure/db/schema/inv.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  InvRepository,
  ItemRow,
  MovementRow,
  NewMovement,
  StockRow,
  StoreRow,
  VariantRow,
} from '../application/InventoryUseCases.js';
import type { MovementType } from '../domain/stock.js';

const itemCols = {
  id: item.id,
  sku: item.sku,
  nameEn: item.nameEn,
  nameBn: item.nameBn,
  category: item.category,
  unit: item.unit,
  isSellable: item.isSellable,
  barcode: item.barcode,
  isActive: item.isActive,
};
const storeCols = {
  id: store.id,
  campusId: store.campusId,
  code: store.code,
  name: store.name,
  kind: store.kind,
  keeperStaffId: store.keeperStaffId,
  isActive: store.isActive,
};
const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

/** Items, stores, the append-only stock ledger and its balances (maintained by the DB trigger). */
export class DrizzleInvRepository implements InvRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async insertItem(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(item)
      .values(values as typeof item.$inferInsert)
      .returning({ id: item.id });
    return r!.id;
  }

  async updateItem(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(item).set(patch).where(eq(item.id, id));
  }

  async item(id: string): Promise<ItemRow | null> {
    const [r] = await this.tx.select(itemCols).from(item).where(eq(item.id, id));
    if (!r) return null;
    const variants = await this.tx
      .select({
        id: itemVariant.id,
        itemId: itemVariant.itemId,
        code: itemVariant.code,
        attributes: itemVariant.attributes,
        barcode: itemVariant.barcode,
        salePricePaisa: itemVariant.salePricePaisa,
      })
      .from(itemVariant)
      .where(eq(itemVariant.itemId, id))
      .orderBy(asc(itemVariant.code));
    return { ...(r as ItemRow), variants: variants as VariantRow[] };
  }

  async items(f: { q?: string; category?: string; active?: boolean }): Promise<ItemRow[]> {
    const where: SQL[] = [];
    if (f.q) where.push(or(ilike(item.nameEn, `%${f.q}%`), ilike(item.sku, `%${f.q}%`), eq(item.barcode, f.q))!);
    if (f.category) where.push(eq(item.category, f.category as ItemRow['category']));
    if (f.active !== undefined) where.push(eq(item.isActive, f.active));
    const rows = (await this.tx
      .select(itemCols)
      .from(item)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(item.nameEn))
      .limit(1000)) as ItemRow[];
    if (!rows.length) return rows;
    const variants = (await this.tx
      .select({
        id: itemVariant.id,
        itemId: itemVariant.itemId,
        code: itemVariant.code,
        attributes: itemVariant.attributes,
        barcode: itemVariant.barcode,
        salePricePaisa: itemVariant.salePricePaisa,
      })
      .from(itemVariant)
      .where(
        inArray(
          itemVariant.itemId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(itemVariant.code))) as VariantRow[];
    return rows.map((r) => ({ ...r, variants: variants.filter((v) => v.itemId === r.id) }));
  }

  async insertVariants(itemId: string, rows: Array<Record<string, unknown>>): Promise<void> {
    if (rows.length)
      await this.tx.insert(itemVariant).values(rows.map((r) => ({ ...r, itemId }) as typeof itemVariant.$inferInsert));
  }

  async variantsWithItems(ids: string[]) {
    if (!ids.length) return new Map();
    const rows = await this.tx
      .select({
        id: itemVariant.id,
        itemId: item.id,
        sku: item.sku,
        name: item.nameEn,
        code: itemVariant.code,
        unit: item.unit,
        isActive: item.isActive,
      })
      .from(itemVariant)
      .innerJoin(item, eq(item.id, itemVariant.itemId))
      .where(inArray(itemVariant.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async insertStore(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(store)
      .values(values as typeof store.$inferInsert)
      .returning({ id: store.id });
    return r!.id;
  }

  async updateStore(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(store).set(patch).where(eq(store.id, id));
  }

  async store(id: string): Promise<StoreRow | null> {
    const [r] = await this.tx.select(storeCols).from(store).where(eq(store.id, id));
    return (r as StoreRow | undefined) ?? null;
  }

  stores(campusId?: string | null): Promise<StoreRow[]> {
    return this.tx
      .select(storeCols)
      .from(store)
      .where(campusId ? eq(store.campusId, campusId) : undefined)
      .orderBy(asc(store.code)) as Promise<StoreRow[]>;
  }

  async lockBalances(storeId: string, variantIds: string[]) {
    const out = new Map<string, { onHand: number; avgCostPaisa: number }>();
    if (!variantIds.length) return out;
    // balances are written only by the ledger trigger (no UPDATE grant), so movements are serialised per store
    await this.tx.select({ id: store.id }).from(store).where(eq(store.id, storeId)).for('update');
    const rows = await this.tx
      .select({
        variantId: stockBalance.itemVariantId,
        onHand: stockBalance.qtyOnHand,
        avg: stockBalance.avgCostPaisa,
      })
      .from(stockBalance)
      .where(
        and(
          eq(stockBalance.storeId, storeId),
          inArray(stockBalance.itemVariantId, variantIds),
          eq(stockBalance.batchNo, ''),
        ),
      );
    for (const r of rows) out.set(r.variantId, { onHand: num(r.onHand), avgCostPaisa: r.avg });
    return out;
  }

  async insertMovements(rows: NewMovement[]): Promise<void> {
    if (!rows.length) return;
    await this.tx.insert(stockMovement).values(
      rows.map((r) => ({
        orgId: r.orgId,
        campusId: r.campusId,
        storeId: r.storeId,
        itemVariantId: r.variantId,
        movementType: r.type,
        qtyDelta: String(r.delta),
        balanceQty: String(r.balanceQty),
        unitCostPaisa: r.unitCostPaisa,
        refType: r.refType ?? null,
        refId: r.refId ?? null,
        transferId: r.transferId ?? null,
        issuedTo: r.issuedTo ?? null,
        reason: r.reason ?? null,
        movedBy: r.movedBy,
      })),
    );
  }

  async stock(storeId: string, f: { q?: string }): Promise<StockRow[]> {
    const where: SQL[] = [eq(stockBalance.storeId, storeId)];
    if (f.q) where.push(or(ilike(item.nameEn, `%${f.q}%`), ilike(item.sku, `%${f.q}%`))!);
    const rows = await this.tx
      .select({
        variantId: itemVariant.id,
        itemId: item.id,
        sku: item.sku,
        itemName: item.nameEn,
        variantCode: itemVariant.code,
        category: item.category,
        unit: item.unit,
        onHand: sql<string>`sum(${stockBalance.qtyOnHand})`,
        avgCostPaisa: sql<number>`max(${stockBalance.avgCostPaisa})`,
        valuePaisa: sql<string>`round(sum(${stockBalance.qtyOnHand} * ${stockBalance.avgCostPaisa}))`,
        minQty: stockLevelRule.minQty,
        maxQty: stockLevelRule.maxQty,
      })
      .from(stockBalance)
      .innerJoin(itemVariant, eq(itemVariant.id, stockBalance.itemVariantId))
      .innerJoin(item, eq(item.id, itemVariant.itemId))
      .leftJoin(
        stockLevelRule,
        and(eq(stockLevelRule.storeId, stockBalance.storeId), eq(stockLevelRule.itemVariantId, itemVariant.id)),
      )
      .where(and(...where))
      .groupBy(itemVariant.id, item.id, stockLevelRule.minQty, stockLevelRule.maxQty)
      .orderBy(asc(item.nameEn), asc(itemVariant.code));
    return rows.map((r) => ({
      ...r,
      onHand: num(r.onHand),
      avgCostPaisa: Number(r.avgCostPaisa),
      valuePaisa: num(r.valuePaisa),
      minQty: r.minQty === null ? null : Number(r.minQty),
      maxQty: r.maxQty === null ? null : Number(r.maxQty),
      low: false,
    }));
  }

  async movements(
    storeId: string,
    f: { variantId?: string; from?: Date; to?: Date; limit: number },
  ): Promise<MovementRow[]> {
    const where: SQL[] = [eq(stockMovement.storeId, storeId)];
    if (f.variantId) where.push(eq(stockMovement.itemVariantId, f.variantId));
    if (f.from) where.push(gte(stockMovement.movedAt, f.from));
    if (f.to) where.push(lte(stockMovement.movedAt, f.to));
    const rows = await this.tx
      .select({
        id: stockMovement.id,
        variantId: stockMovement.itemVariantId,
        sku: item.sku,
        itemName: item.nameEn,
        variantCode: itemVariant.code,
        movementType: stockMovement.movementType,
        qtyDelta: stockMovement.qtyDelta,
        balanceQty: stockMovement.balanceQty,
        unitCostPaisa: stockMovement.unitCostPaisa,
        refType: stockMovement.refType,
        refId: stockMovement.refId,
        issuedTo: stockMovement.issuedTo,
        reason: stockMovement.reason,
        movedBy: stockMovement.movedBy,
        movedAt: stockMovement.movedAt,
      })
      .from(stockMovement)
      .innerJoin(itemVariant, eq(itemVariant.id, stockMovement.itemVariantId))
      .innerJoin(item, eq(item.id, itemVariant.itemId))
      .where(and(...where))
      .orderBy(desc(stockMovement.id))
      .limit(f.limit);
    return rows.map((r) => ({
      ...r,
      movementType: r.movementType as MovementType,
      qtyDelta: Number(r.qtyDelta),
      balanceQty: r.balanceQty === null ? null : Number(r.balanceQty),
    }));
  }

  async setLevel(storeId: string, variantId: string, minQty: number, maxQty: number | null): Promise<void> {
    await this.tx
      .insert(stockLevelRule)
      .values({
        storeId,
        itemVariantId: variantId,
        minQty: String(minQty),
        maxQty: maxQty === null ? null : String(maxQty),
      })
      .onConflictDoUpdate({
        target: [stockLevelRule.storeId, stockLevelRule.itemVariantId],
        set: { minQty: String(minQty), maxQty: maxQty === null ? null : String(maxQty) },
      });
  }

  async insertTransfer(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(transfer)
      .values(values as typeof transfer.$inferInsert)
      .returning({ id: transfer.id });
    return r!.id;
  }
}
