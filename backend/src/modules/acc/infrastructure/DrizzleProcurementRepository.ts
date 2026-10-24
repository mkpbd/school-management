import { and, asc, between, desc, eq, ilike, inArray, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  account,
  budget,
  budgetLine,
  costCentre,
  goodsReceipt,
  goodsReceiptLine,
  journal,
  journalLine,
  purchaseOrder,
  purchaseOrderLine,
  purchaseRequisition,
  purchaseRequisitionLine,
  quotation,
  supplierBill,
  supplierBillLine,
  supplierPayment,
  vendor,
} from '../../../shared/infrastructure/db/schema/acc.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  AccountBrief,
  BillRow,
  BudgetLineRow,
  BudgetRow,
  CostCentreRow,
  PaymentRow,
  PoLineRow,
  PoRow,
  ProcurementRepository,
  QuotationRow,
  ReceiptRow,
  RequisitionLineRow,
  RequisitionRow,
  VendorRow,
  VendorStats,
} from '../application/procurementPorts.js';

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

const vendorCols = {
  id: vendor.id,
  code: vendor.code,
  name: vendor.name,
  phone: vendor.phone,
  email: vendor.email,
  address: vendor.address,
  tin: vendor.tin,
  binVat: vendor.binVat,
  tdsRatePct: vendor.tdsRatePct,
  vatRatePct: vendor.vatRatePct,
  paymentTermsDays: vendor.paymentTermsDays,
  performanceNote: vendor.performanceNote,
  isActive: vendor.isActive,
};
const toVendor = (r: Record<string, unknown>): VendorRow =>
  ({
    ...r,
    tdsRatePct: num(r.tdsRatePct as string | null),
    vatRatePct: num(r.vatRatePct as string | null),
  }) as VendorRow;

const budgetCols = {
  id: budget.id,
  campusId: budget.campusId,
  academicYearId: budget.academicYearId,
  name: budget.name,
  status: budget.status,
  revisionOfId: budget.revisionOfId,
  submittedBy: budget.submittedBy,
  submittedAt: budget.submittedAt,
  decidedBy: budget.decidedBy,
  decidedAt: budget.decidedAt,
  decisionNote: budget.decisionNote,
};

const prCols = {
  id: purchaseRequisition.id,
  campusId: purchaseRequisition.campusId,
  prNo: purchaseRequisition.prNo,
  title: purchaseRequisition.title,
  departmentId: purchaseRequisition.departmentId,
  costCentreId: purchaseRequisition.costCentreId,
  requestedBy: purchaseRequisition.requestedBy,
  neededBy: purchaseRequisition.neededBy,
  justification: purchaseRequisition.justification,
  status: purchaseRequisition.status,
  submittedAt: purchaseRequisition.submittedAt,
  decidedBy: purchaseRequisition.decidedBy,
  decidedAt: purchaseRequisition.decidedAt,
  decisionNote: purchaseRequisition.decisionNote,
  overBudget: purchaseRequisition.overBudget,
  overrunReason: purchaseRequisition.overrunReason,
  overrunApprovedBy: purchaseRequisition.overrunApprovedBy,
  createdAt: purchaseRequisition.createdAt,
};

const poCols = {
  id: purchaseOrder.id,
  campusId: purchaseOrder.campusId,
  poNo: purchaseOrder.poNo,
  vendorId: purchaseOrder.vendorId,
  vendorName: vendor.name,
  requisitionId: purchaseOrder.requisitionId,
  quotationId: purchaseOrder.quotationId,
  costCentreId: purchaseOrder.costCentreId,
  orderDate: purchaseOrder.orderDate,
  expectedOn: purchaseOrder.expectedOn,
  totalPaisa: purchaseOrder.totalPaisa,
  status: purchaseOrder.status,
  terms: purchaseOrder.terms,
  issuedBy: purchaseOrder.issuedBy,
  cancelledReason: purchaseOrder.cancelledReason,
};

const billCols = {
  id: supplierBill.id,
  campusId: supplierBill.campusId,
  vendorId: supplierBill.vendorId,
  vendorName: vendor.name,
  purchaseOrderId: supplierBill.purchaseOrderId,
  billNo: supplierBill.billNo,
  billDate: supplierBill.billDate,
  dueDate: supplierBill.dueDate,
  grossPaisa: supplierBill.grossPaisa,
  vatPaisa: supplierBill.vatPaisa,
  tdsPaisa: supplierBill.tdsPaisa,
  netPayablePaisa: supplierBill.netPayablePaisa,
  paidPaisa: supplierBill.paidPaisa,
  status: supplierBill.status,
  journalId: supplierBill.journalId,
};

/** Budgets, vendors, requisitions, quotations, purchase orders, receipts, supplier bills and payments. */
export class DrizzleProcurementRepository implements ProcurementRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  // ---------------- vendors / cost centres / accounts ----------------

  async insertVendor(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(vendor)
      .values(values as typeof vendor.$inferInsert)
      .returning({ id: vendor.id });
    return r!.id;
  }

  async updateVendor(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(vendor).set(patch).where(eq(vendor.id, id));
  }

  async vendor(id: string): Promise<VendorRow | null> {
    const [r] = await this.tx.select(vendorCols).from(vendor).where(eq(vendor.id, id));
    return r ? toVendor(r) : null;
  }

  async vendors(f: { q?: string; active?: boolean }): Promise<VendorRow[]> {
    const where: SQL[] = [];
    if (f.q) where.push(or(ilike(vendor.name, `%${f.q}%`), ilike(vendor.code, `%${f.q}%`))!);
    if (f.active !== undefined) where.push(eq(vendor.isActive, f.active));
    const rows = await this.tx
      .select(vendorCols)
      .from(vendor)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(vendor.name));
    return rows.map(toVendor);
  }

  async vendorStats(vendorId: string): Promise<VendorStats> {
    const [po] = await this.tx
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${purchaseOrder.totalPaisa}), 0)::bigint`,
      })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.vendorId, vendorId), ne(purchaseOrder.status, 'cancelled')));
    const [grn] = await this.tx
      .select({
        n: sql<number>`count(*)::int`,
        onTime: sql<number | null>`round(100.0 * avg(CASE WHEN ${goodsReceipt.onTime} THEN 1 ELSE 0 END), 1)`,
        rating: sql<number | null>`round(avg(${goodsReceipt.rating}), 2)`,
      })
      .from(goodsReceipt)
      .innerJoin(purchaseOrder, eq(purchaseOrder.id, goodsReceipt.purchaseOrderId))
      .where(eq(purchaseOrder.vendorId, vendorId));
    const [bills] = await this.tx
      .select({
        billed: sql<number>`coalesce(sum(${supplierBill.netPayablePaisa}), 0)::bigint`,
        outstanding: sql<number>`coalesce(sum(${supplierBill.netPayablePaisa} - ${supplierBill.paidPaisa}), 0)::bigint`,
      })
      .from(supplierBill)
      .where(and(eq(supplierBill.vendorId, vendorId), ne(supplierBill.status, 'cancelled')));
    return {
      orders: po!.n,
      orderedPaisa: Number(po!.total),
      receipts: grn!.n,
      onTimePct: grn!.onTime === null ? null : Number(grn!.onTime),
      avgRating: grn!.rating === null ? null : Number(grn!.rating),
      billedPaisa: Number(bills!.billed),
      outstandingPaisa: Number(bills!.outstanding),
    };
  }

  costCentres(): Promise<CostCentreRow[]> {
    return this.tx
      .select({
        id: costCentre.id,
        code: costCentre.code,
        nameEn: costCentre.nameEn,
        campusId: costCentre.campusId,
        departmentId: costCentre.departmentId,
        isActive: costCentre.isActive,
      })
      .from(costCentre)
      .orderBy(asc(costCentre.code));
  }

  async costCentre(id: string): Promise<CostCentreRow | null> {
    return (await this.costCentres()).find((c) => c.id === id) ?? null;
  }

  async insertCostCentre(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(costCentre)
      .values(values as typeof costCentre.$inferInsert)
      .returning({ id: costCentre.id });
    return r!.id;
  }

  async accounts(ids: string[]): Promise<Map<string, AccountBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.tx
      .select({
        id: account.id,
        code: account.code,
        nameEn: account.nameEn,
        kind: account.kind,
        isPostable: account.isPostable,
        isActive: account.isActive,
      })
      .from(account)
      .where(inArray(account.id, ids));
    return new Map(rows.map((r) => [r.id, r as AccountBrief]));
  }

  // ---------------- budgets ----------------

  async insertBudget(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(budget)
      .values(values as typeof budget.$inferInsert)
      .returning({ id: budget.id });
    return r!.id;
  }

  async budget(id: string, lock = false): Promise<BudgetRow | null> {
    const q = this.tx.select(budgetCols).from(budget).where(eq(budget.id, id));
    const [r] = lock ? await q.for('update') : await q;
    return r ?? null;
  }

  budgets(f: { campusId?: string | null; academicYearId?: string; status?: string }): Promise<BudgetRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(budget.campusId, f.campusId));
    if (f.academicYearId) where.push(eq(budget.academicYearId, f.academicYearId));
    if (f.status) where.push(eq(budget.status, f.status as 'draft'));
    return this.tx
      .select(budgetCols)
      .from(budget)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(budget.createdAt));
  }

  async approvedBudget(campusId: string, academicYearId: string): Promise<BudgetRow | null> {
    const [r] = await this.tx
      .select(budgetCols)
      .from(budget)
      .where(
        and(eq(budget.campusId, campusId), eq(budget.academicYearId, academicYearId), eq(budget.status, 'approved')),
      );
    return r ?? null;
  }

  async setBudget(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(budget).set(patch).where(eq(budget.id, id));
  }

  async replaceBudgetLines(budgetId: string, rows: BudgetLineRow[]): Promise<void> {
    await this.tx.delete(budgetLine).where(eq(budgetLine.budgetId, budgetId));
    if (rows.length) await this.tx.insert(budgetLine).values(rows.map((r) => ({ budgetId, ...r })));
  }

  budgetLines(budgetId: string): Promise<BudgetLineRow[]> {
    return this.tx
      .select({
        accountId: budgetLine.accountId,
        costCentreId: budgetLine.costCentreId,
        monthNo: budgetLine.monthNo,
        amountPaisa: budgetLine.amountPaisa,
      })
      .from(budgetLine)
      .innerJoin(budget, eq(budget.id, budgetLine.budgetId))
      .where(eq(budgetLine.budgetId, budgetId))
      .orderBy(asc(budgetLine.accountId), asc(budgetLine.monthNo));
  }

  async actuals(f: { campusId: string; from: string; to: string }) {
    const rows = await this.tx
      .select({
        accountId: journalLine.accountId,
        costCentreId: journalLine.costCentreId,
        debitPaisa: sql<number>`sum(${journalLine.debitPaisa})::bigint`,
        creditPaisa: sql<number>`sum(${journalLine.creditPaisa})::bigint`,
      })
      .from(journalLine)
      .innerJoin(journal, eq(journal.id, journalLine.journalId))
      .where(
        and(
          eq(journalLine.campusId, f.campusId),
          eq(journal.status, 'posted'),
          between(journal.journalDate, f.from, f.to),
        ),
      )
      .groupBy(journalLine.accountId, journalLine.costCentreId);
    return rows.map((r) => ({ ...r, debitPaisa: Number(r.debitPaisa), creditPaisa: Number(r.creditPaisa) }));
  }

  async commitments(f: { campusId: string; from: string; to: string }) {
    const rows = await this.tx
      .select({
        accountId: purchaseOrderLine.accountId,
        costCentreId: purchaseOrder.costCentreId,
        paisa: sql<number>`sum(round((${purchaseOrderLine.quantity} - ${purchaseOrderLine.billedQty}) * ${purchaseOrderLine.unitPaisa}))::bigint`,
      })
      .from(purchaseOrderLine)
      .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.purchaseOrderId))
      .where(
        and(
          eq(purchaseOrder.campusId, f.campusId),
          notInArray(purchaseOrder.status, ['cancelled', 'closed', 'draft']),
          between(purchaseOrder.orderDate, f.from, f.to),
        ),
      )
      .groupBy(purchaseOrderLine.accountId, purchaseOrder.costCentreId);
    return rows
      .filter((r) => r.accountId !== null)
      .map((r) => ({ accountId: r.accountId!, costCentreId: r.costCentreId, paisa: Number(r.paisa) }));
  }

  // ---------------- requisitions / quotations ----------------

  async insertRequisition(values: Record<string, unknown>, lines: Array<Record<string, unknown>>): Promise<string> {
    const [r] = await this.tx
      .insert(purchaseRequisition)
      .values(values as typeof purchaseRequisition.$inferInsert)
      .returning({ id: purchaseRequisition.id });
    await this.tx
      .insert(purchaseRequisitionLine)
      .values(lines.map((l) => ({ ...l, requisitionId: r!.id }) as typeof purchaseRequisitionLine.$inferInsert));
    return r!.id;
  }

  async requisition(id: string, lock = false): Promise<RequisitionRow | null> {
    const q = this.tx.select(prCols).from(purchaseRequisition).where(eq(purchaseRequisition.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) return null;
    const lines = await this.tx
      .select({
        id: purchaseRequisitionLine.id,
        lineNo: purchaseRequisitionLine.lineNo,
        description: purchaseRequisitionLine.description,
        quantity: purchaseRequisitionLine.quantity,
        estUnitPaisa: purchaseRequisitionLine.estUnitPaisa,
        accountId: purchaseRequisitionLine.accountId,
        itemVariantId: purchaseRequisitionLine.itemVariantId,
      })
      .from(purchaseRequisitionLine)
      .where(eq(purchaseRequisitionLine.requisitionId, id))
      .orderBy(asc(purchaseRequisitionLine.lineNo));
    return { ...r, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) }) as RequisitionLineRow) };
  }

  requisitions(f: { campusId?: string | null; status?: string; requestedBy?: string }): Promise<RequisitionRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(purchaseRequisition.campusId, f.campusId));
    if (f.status) where.push(eq(purchaseRequisition.status, f.status as 'draft'));
    if (f.requestedBy) where.push(eq(purchaseRequisition.requestedBy, f.requestedBy));
    return this.tx
      .select(prCols)
      .from(purchaseRequisition)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(purchaseRequisition.createdAt))
      .limit(500);
  }

  async setRequisition(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(purchaseRequisition).set(patch).where(eq(purchaseRequisition.id, id));
  }

  async insertQuotation(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(quotation)
      .values(values as typeof quotation.$inferInsert)
      .returning({ id: quotation.id });
    return r!.id;
  }

  quotations(requisitionId: string): Promise<QuotationRow[]> {
    return this.tx
      .select({
        id: quotation.id,
        requisitionId: quotation.requisitionId,
        vendorId: quotation.vendorId,
        vendorName: vendor.name,
        totalPaisa: quotation.totalPaisa,
        validUntil: quotation.validUntil,
        deliveryDays: quotation.deliveryDays,
        quoteRef: quotation.quoteRef,
        note: quotation.note,
        fileId: quotation.fileId,
        isSelected: quotation.isSelected,
        selectionReason: quotation.selectionReason,
      })
      .from(quotation)
      .innerJoin(vendor, eq(vendor.id, quotation.vendorId))
      .where(eq(quotation.requisitionId, requisitionId))
      .orderBy(asc(quotation.totalPaisa));
  }

  async selectQuotation(requisitionId: string, quotationId: string, reason: string | null): Promise<void> {
    await this.tx
      .update(quotation)
      .set({ isSelected: false, selectionReason: null })
      .where(and(eq(quotation.requisitionId, requisitionId), eq(quotation.isSelected, true)));
    await this.tx
      .update(quotation)
      .set({ isSelected: true, selectionReason: reason })
      .where(eq(quotation.id, quotationId));
  }

  // ---------------- purchase orders / receipts ----------------

  async insertPo(values: Record<string, unknown>, lines: Array<Record<string, unknown>>): Promise<string> {
    const [r] = await this.tx
      .insert(purchaseOrder)
      .values(values as typeof purchaseOrder.$inferInsert)
      .returning({ id: purchaseOrder.id });
    await this.tx
      .insert(purchaseOrderLine)
      .values(
        lines.map(
          (l) =>
            ({ ...l, quantity: String(l.quantity), purchaseOrderId: r!.id }) as typeof purchaseOrderLine.$inferInsert,
        ),
      );
    return r!.id;
  }

  async po(id: string, lock = false): Promise<PoRow | null> {
    if (lock)
      await this.tx.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.id, id)).for('update');
    const [r] = await this.tx
      .select(poCols)
      .from(purchaseOrder)
      .innerJoin(vendor, eq(vendor.id, purchaseOrder.vendorId))
      .where(eq(purchaseOrder.id, id));
    if (!r) return null;
    const lines = await this.tx
      .select({
        id: purchaseOrderLine.id,
        lineNo: purchaseOrderLine.lineNo,
        description: purchaseOrderLine.description,
        quantity: purchaseOrderLine.quantity,
        unitPaisa: purchaseOrderLine.unitPaisa,
        receivedQty: purchaseOrderLine.receivedQty,
        billedQty: purchaseOrderLine.billedQty,
        accountId: purchaseOrderLine.accountId,
        itemVariantId: purchaseOrderLine.itemVariantId,
      })
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, id))
      .orderBy(asc(purchaseOrderLine.lineNo));
    return {
      ...r,
      lines: lines.map(
        (l) =>
          ({
            ...l,
            quantity: Number(l.quantity),
            receivedQty: Number(l.receivedQty),
            billedQty: Number(l.billedQty),
          }) as PoLineRow,
      ),
    };
  }

  pos(f: { campusId?: string | null; status?: string; vendorId?: string }): Promise<PoRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(purchaseOrder.campusId, f.campusId));
    if (f.status) where.push(eq(purchaseOrder.status, f.status as 'issued'));
    if (f.vendorId) where.push(eq(purchaseOrder.vendorId, f.vendorId));
    return this.tx
      .select(poCols)
      .from(purchaseOrder)
      .innerJoin(vendor, eq(vendor.id, purchaseOrder.vendorId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(purchaseOrder.orderDate), desc(purchaseOrder.poNo))
      .limit(500);
  }

  async setPo(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(purchaseOrder).set(patch).where(eq(purchaseOrder.id, id));
  }

  async setPoLineQuantities(lineId: string, patch: { receivedQty?: number; billedQty?: number }): Promise<void> {
    const set: Record<string, string> = {};
    if (patch.receivedQty !== undefined) set.receivedQty = String(patch.receivedQty);
    if (patch.billedQty !== undefined) set.billedQty = String(patch.billedQty);
    await this.tx.update(purchaseOrderLine).set(set).where(eq(purchaseOrderLine.id, lineId));
  }

  async insertReceipt(
    values: Record<string, unknown>,
    lines: Array<{ poLineId: string; quantity: number }>,
  ): Promise<string> {
    const [r] = await this.tx
      .insert(goodsReceipt)
      .values(values as typeof goodsReceipt.$inferInsert)
      .returning({ id: goodsReceipt.id });
    await this.tx
      .insert(goodsReceiptLine)
      .values(lines.map((l) => ({ receiptId: r!.id, poLineId: l.poLineId, quantity: String(l.quantity) })));
    return r!.id;
  }

  async receipts(poId: string): Promise<ReceiptRow[]> {
    const rows = await this.tx
      .select({
        id: goodsReceipt.id,
        grnNo: goodsReceipt.grnNo,
        storeId: goodsReceipt.storeId,
        receivedOn: goodsReceipt.receivedOn,
        receivedBy: goodsReceipt.receivedBy,
        onTime: goodsReceipt.onTime,
        rating: goodsReceipt.rating,
        note: goodsReceipt.note,
      })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.purchaseOrderId, poId))
      .orderBy(asc(goodsReceipt.receivedOn), asc(goodsReceipt.grnNo));
    if (!rows.length) return [];
    const lines = await this.tx
      .select({
        receiptId: goodsReceiptLine.receiptId,
        poLineId: goodsReceiptLine.poLineId,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .where(
        inArray(
          goodsReceiptLine.receiptId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({
      ...r,
      lines: lines
        .filter((l) => l.receiptId === r.id)
        .map((l) => ({ poLineId: l.poLineId, quantity: Number(l.quantity) })),
    }));
  }

  // ---------------- bills / payments ----------------

  async insertBill(
    values: Record<string, unknown>,
    lines: Array<{ poLineId: string; quantity: number; amountPaisa: number }>,
  ): Promise<string> {
    const [r] = await this.tx
      .insert(supplierBill)
      .values(values as typeof supplierBill.$inferInsert)
      .returning({ id: supplierBill.id });
    if (lines.length)
      await this.tx.insert(supplierBillLine).values(
        lines.map((l) => ({
          billId: r!.id,
          poLineId: l.poLineId,
          quantity: String(l.quantity),
          amountPaisa: l.amountPaisa,
        })),
      );
    return r!.id;
  }

  async bill(id: string, lock = false): Promise<BillRow | null> {
    if (lock)
      await this.tx.select({ id: supplierBill.id }).from(supplierBill).where(eq(supplierBill.id, id)).for('update');
    const [r] = await this.tx
      .select(billCols)
      .from(supplierBill)
      .innerJoin(vendor, eq(vendor.id, supplierBill.vendorId))
      .where(eq(supplierBill.id, id));
    return r ?? null;
  }

  bills(f: {
    campusId?: string | null;
    vendorId?: string;
    status?: string;
    purchaseOrderId?: string;
    open?: boolean;
  }): Promise<BillRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(supplierBill.campusId, f.campusId));
    if (f.vendorId) where.push(eq(supplierBill.vendorId, f.vendorId));
    if (f.status) where.push(eq(supplierBill.status, f.status as 'open'));
    if (f.purchaseOrderId) where.push(eq(supplierBill.purchaseOrderId, f.purchaseOrderId));
    if (f.open) where.push(inArray(supplierBill.status, ['open', 'partially_paid']));
    return this.tx
      .select(billCols)
      .from(supplierBill)
      .innerJoin(vendor, eq(vendor.id, supplierBill.vendorId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(supplierBill.dueDate), asc(supplierBill.billNo))
      .limit(1000);
  }

  async setBill(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(supplierBill).set(patch).where(eq(supplierBill.id, id));
  }

  async insertPayment(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(supplierPayment)
      .values(values as typeof supplierPayment.$inferInsert)
      .returning({ id: supplierPayment.id });
    return r!.id;
  }

  payments(billId: string): Promise<PaymentRow[]> {
    return this.tx
      .select({
        id: supplierPayment.id,
        paymentNo: supplierPayment.paymentNo,
        supplierBillId: supplierPayment.supplierBillId,
        paidOn: supplierPayment.paidOn,
        amountPaisa: supplierPayment.amountPaisa,
        method: supplierPayment.method,
        reference: supplierPayment.reference,
        journalId: supplierPayment.journalId,
      })
      .from(supplierPayment)
      .where(eq(supplierPayment.supplierBillId, billId))
      .orderBy(asc(supplierPayment.paidOn));
  }
}
