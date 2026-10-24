import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  billingRun,
  cashSession,
  concessionType,
  feeHead,
  feeStructure,
  feeStructureLine,
  invoice,
  invoiceLine,
  payment,
  paymentAllocation,
  receipt,
  studentConcession,
  studentFeeItem,
} from '../../../shared/infrastructure/db/schema/fee.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { ConcessionSource, FeeLineSource, OpenLine } from '../domain/billing.js';
import type {
  FeeRepository,
  InvoiceView,
  PaymentView,
  StructureLineInput,
  StructureView,
} from '../application/ports.js';

const invoiceCols = {
  id: invoice.id,
  invoiceNo: invoice.invoiceNo,
  campusId: invoice.campusId,
  familyId: invoice.familyId,
  studentId: invoice.studentId,
  enrolmentId: invoice.enrolmentId,
  billingPeriod: invoice.billingPeriod,
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  grossPaisa: invoice.grossPaisa,
  discountPaisa: invoice.discountPaisa,
  netPaisa: invoice.netPaisa,
  paidPaisa: invoice.paidPaisa,
  outstandingPaisa: sql<number>`(${invoice.netPaisa} - ${invoice.paidPaisa})::bigint`,
  status: invoice.status,
  payToken: invoice.payToken,
};

export class DrizzleFeeRepository implements FeeRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  // ---------------- structures ----------------
  async insertStructure(header: Record<string, unknown>, lines: StructureLineInput[]): Promise<string> {
    const [row] = await this.tx
      .insert(feeStructure)
      .values(header as typeof feeStructure.$inferInsert)
      .returning({ id: feeStructure.id });
    if (lines.length) {
      await this.tx.insert(feeStructureLine).values(
        lines.map((l) => ({
          feeStructureId: row!.id,
          feeHeadId: l.feeHeadId,
          amountPaisa: l.amountPaisa,
          billingMonths: l.billingMonths ?? null,
          dueDay: l.dueDay ?? 10,
          appliesTo: l.appliesTo ?? 'all',
        })),
      );
    }
    return row!.id;
  }

  async getStructure(id: string): Promise<StructureView | null> {
    const [s] = await this.tx.select().from(feeStructure).where(eq(feeStructure.id, id));
    if (!s) return null;
    const lines = await this.tx
      .select({
        id: feeStructureLine.id,
        feeHeadId: feeStructureLine.feeHeadId,
        amountPaisa: feeStructureLine.amountPaisa,
        billingMonths: feeStructureLine.billingMonths,
        dueDay: feeStructureLine.dueDay,
        appliesTo: feeStructureLine.appliesTo,
        headCode: feeHead.code,
        headName: feeHead.nameEn,
      })
      .from(feeStructureLine)
      .innerJoin(feeHead, eq(feeHead.id, feeStructureLine.feeHeadId))
      .where(eq(feeStructureLine.feeStructureId, id))
      .orderBy(asc(feeHead.priority));
    return {
      id: s.id,
      campusId: s.campusId,
      academicYearId: s.academicYearId,
      yearGroupId: s.yearGroupId,
      name: s.name,
      status: s.status,
      version: s.version,
      lines,
    };
  }

  async activateStructure(id: string): Promise<void> {
    const [s] = await this.tx.select().from(feeStructure).where(eq(feeStructure.id, id)).for('update');
    if (!s) return;
    await this.tx
      .update(feeStructure)
      .set({ status: 'retired' })
      .where(
        and(
          eq(feeStructure.campusId, s.campusId),
          eq(feeStructure.academicYearId, s.academicYearId),
          eq(feeStructure.yearGroupId, s.yearGroupId),
          eq(feeStructure.status, 'active'),
          ne(feeStructure.id, id),
        ),
      );
    await this.tx.update(feeStructure).set({ status: 'active' }).where(eq(feeStructure.id, id));
  }

  async activeStructureSources(campusId: string, academicYearId: string, yearGroupId: string) {
    const rows = await this.tx
      .select({
        structureId: feeStructure.id,
        lineId: feeStructureLine.id,
        feeHeadId: feeStructureLine.feeHeadId,
        headName: feeHead.nameEn,
        amountPaisa: feeStructureLine.amountPaisa,
        billingMonths: feeStructureLine.billingMonths,
        dueDay: feeStructureLine.dueDay,
        appliesTo: feeStructureLine.appliesTo,
        priority: feeHead.priority,
        isDiscountable: feeHead.isDiscountable,
      })
      .from(feeStructure)
      .innerJoin(feeStructureLine, eq(feeStructureLine.feeStructureId, feeStructure.id))
      .innerJoin(feeHead, eq(feeHead.id, feeStructureLine.feeHeadId))
      .where(
        and(
          eq(feeStructure.campusId, campusId),
          eq(feeStructure.academicYearId, academicYearId),
          eq(feeStructure.yearGroupId, yearGroupId),
          eq(feeStructure.status, 'active'),
        ),
      );
    if (!rows.length) return null;
    return {
      structureId: rows[0]!.structureId,
      dueDay: Math.min(...rows.map((r) => r.dueDay)),
      sources: rows.map((r): FeeLineSource => ({
        feeHeadId: r.feeHeadId,
        headName: r.headName,
        amountPaisa: r.amountPaisa,
        billingMonths: r.billingMonths,
        appliesTo: r.appliesTo,
        priority: r.priority,
        isDiscountable: r.isDiscountable,
        source: 'structure',
        sourceRef: r.lineId,
      })),
    };
  }

  async studentItemSources(enrolmentId: string, onDate: string): Promise<FeeLineSource[]> {
    const rows = await this.tx
      .select({
        id: studentFeeItem.id,
        feeHeadId: studentFeeItem.feeHeadId,
        headName: feeHead.nameEn,
        amountPaisa: studentFeeItem.amountPaisa,
        billingMonths: studentFeeItem.billingMonths,
        priority: feeHead.priority,
        isDiscountable: feeHead.isDiscountable,
      })
      .from(studentFeeItem)
      .innerJoin(feeHead, eq(feeHead.id, studentFeeItem.feeHeadId))
      .where(
        and(
          eq(studentFeeItem.enrolmentId, enrolmentId),
          lte(studentFeeItem.validFrom, onDate),
          or(isNull(studentFeeItem.validTo), gte(studentFeeItem.validTo, onDate)),
        ),
      );
    return rows.map((r) => ({
      feeHeadId: r.feeHeadId,
      headName: r.headName,
      amountPaisa: r.amountPaisa,
      billingMonths: r.billingMonths,
      appliesTo: 'all',
      priority: r.priority,
      isDiscountable: r.isDiscountable,
      source: 'student_item',
      sourceRef: r.id,
    }));
  }

  // ---------------- concessions ----------------
  async approvedConcessions(studentId: string, onDate: string): Promise<ConcessionSource[]> {
    const rows = await this.tx
      .select({
        id: studentConcession.id,
        feeHeadId: studentConcession.feeHeadId,
        valuePercent: studentConcession.valuePercent,
        valuePaisa: studentConcession.valuePaisa,
        calc: concessionType.calc,
        headIds: concessionType.appliesToHeadIds,
        stacking: concessionType.stacking,
        cap: concessionType.maxPercentCap,
      })
      .from(studentConcession)
      .innerJoin(concessionType, eq(concessionType.id, studentConcession.concessionTypeId))
      .where(
        and(
          eq(studentConcession.studentId, studentId),
          eq(studentConcession.status, 'approved'),
          lte(studentConcession.validFrom, onDate),
          gte(studentConcession.validTo, onDate),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      feeHeadIds: r.feeHeadId ? [r.feeHeadId] : r.headIds,
      calc: r.calc,
      valuePercent: r.valuePercent !== null ? Number(r.valuePercent) : null,
      valuePaisa: r.valuePaisa,
      stacking: r.stacking,
      maxPercentCap: r.cap !== null ? Number(r.cap) : null,
    }));
  }

  async concessionType(id: string) {
    const [r] = await this.tx
      .select({ id: concessionType.id, calc: concessionType.calc, requiresApproval: concessionType.requiresApproval })
      .from(concessionType)
      .where(eq(concessionType.id, id));
    return r ?? null;
  }

  async insertConcession(values: Record<string, unknown>) {
    const [r] = await this.tx
      .insert(studentConcession)
      .values(values as typeof studentConcession.$inferInsert)
      .returning({ id: studentConcession.id, status: studentConcession.status });
    return r!;
  }

  async concessionForUpdate(id: string) {
    const [r] = await this.tx
      .select({ id: studentConcession.id, campusId: studentConcession.campusId, status: studentConcession.status })
      .from(studentConcession)
      .where(eq(studentConcession.id, id))
      .for('update');
    return r ?? null;
  }

  async setConcessionStatus(id: string, status: 'approved' | 'rejected' | 'revoked') {
    await this.tx.update(studentConcession).set({ status }).where(eq(studentConcession.id, id));
  }

  // ---------------- invoices ----------------
  async invoiceExistsFor(enrolmentId: string, period: string) {
    const rows = await this.tx
      .select({ id: invoice.id })
      .from(invoice)
      .where(and(eq(invoice.enrolmentId, enrolmentId), eq(invoice.billingPeriod, period), ne(invoice.status, 'void')))
      .limit(1);
    return rows.length > 0;
  }

  async hasInvoiceInYear(enrolmentId: string) {
    const rows = await this.tx
      .select({ id: invoice.id })
      .from(invoice)
      .where(and(eq(invoice.enrolmentId, enrolmentId), isNotNull(invoice.billingRunId), ne(invoice.status, 'void')))
      .limit(1);
    return rows.length > 0;
  }

  async insertInvoice(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(invoice)
      .values(values as typeof invoice.$inferInsert)
      .returning({ id: invoice.id });
    return r!.id;
  }

  async insertInvoiceLines(invoiceId: string, orgId: string, campusId: string, lines: Array<Record<string, unknown>>) {
    if (!lines.length) return;
    await this.tx.insert(invoiceLine).values(
      lines.map((l) => ({
        invoiceId,
        orgId,
        campusId,
        feeHeadId: l.feeHeadId as string,
        description: l.description as string,
        amountPaisa: l.amountPaisa as number,
        discountPaisa: (l.discountPaisa as number | undefined) ?? 0,
        concessionId: (l.concessionId as string | null | undefined) ?? null,
        source: l.source as 'structure',
        sourceRef: (l.sourceRef as string | undefined) ?? null,
        priority: (l.priority as number | undefined) ?? 100,
      })),
    );
  }

  async issueInvoice(id: string): Promise<InvoiceView> {
    await this.tx.update(invoice).set({ status: 'issued' }).where(eq(invoice.id, id));
    return (await this.getInvoice(id, false))!;
  }

  async getInvoice(id: string, withLines: boolean): Promise<InvoiceView | null> {
    const [inv] = await this.tx.select(invoiceCols).from(invoice).where(eq(invoice.id, id));
    if (!inv) return null;
    if (!withLines) return inv;
    const lines = await this.tx
      .select({
        id: invoiceLine.id,
        feeHeadId: invoiceLine.feeHeadId,
        description: invoiceLine.description,
        amountPaisa: invoiceLine.amountPaisa,
        discountPaisa: invoiceLine.discountPaisa,
        netPaisa: sql<number>`${invoiceLine.netPaisa}`,
        paidPaisa: invoiceLine.paidPaisa,
        source: invoiceLine.source,
      })
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, id))
      .orderBy(asc(invoiceLine.priority), asc(invoiceLine.createdAt));
    return { ...inv, lines };
  }

  listInvoices(f: Parameters<FeeRepository['listInvoices']>[0]): Promise<InvoiceView[]> {
    const where: SQL[] = [];
    if (f.familyId) where.push(eq(invoice.familyId, f.familyId));
    if (f.studentId) where.push(eq(invoice.studentId, f.studentId));
    if (f.campusId) where.push(eq(invoice.campusId, f.campusId));
    if (f.status) where.push(eq(invoice.status, f.status as 'issued'));
    if (f.period) where.push(eq(invoice.billingPeriod, f.period));
    if (f.overdueOn)
      where.push(lt(invoice.dueDate, f.overdueOn), inArray(invoice.status, ['issued', 'partially_paid']));
    return this.tx
      .select(invoiceCols)
      .from(invoice)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(invoice.dueDate), desc(invoice.id))
      .limit(f.limit)
      .offset(f.offset);
  }

  async voidInvoice(id: string, reason: string) {
    await this.tx
      .update(invoice)
      .set({ status: 'void', voidReason: reason, voidedAt: new Date() })
      .where(eq(invoice.id, id));
  }

  async insertStudentFeeItem(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(studentFeeItem)
      .values(values as typeof studentFeeItem.$inferInsert)
      .returning({ id: studentFeeItem.id });
    return r!.id;
  }

  async endStudentFeeItems(sourceModule: string, sourceRef: string, validTo: string): Promise<number> {
    const rows = await this.tx
      .update(studentFeeItem)
      .set({ validTo })
      .where(
        and(
          eq(studentFeeItem.sourceModule, sourceModule),
          eq(studentFeeItem.sourceRef, sourceRef),
          or(isNull(studentFeeItem.validTo), gt(studentFeeItem.validTo, validTo)),
        ),
      )
      .returning({ id: studentFeeItem.id });
    return rows.length;
  }

  async feeHeadByCode(code: string) {
    const [r] = await this.tx
      .select({ id: feeHead.id, priority: feeHead.priority })
      .from(feeHead)
      .where(eq(feeHead.code, code));
    return r ?? null;
  }

  async chargeLine(source: string, sourceRef: string) {
    const [r] = await this.tx
      .select({ invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, lineId: invoiceLine.id })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .where(
        and(eq(invoiceLine.source, source as never), eq(invoiceLine.sourceRef, sourceRef), ne(invoice.status, 'void')),
      );
    return r ?? null;
  }

  // ---------------- payments ----------------
  async lockOpenLines(f: { familyId: string; campusId: string; invoiceIds?: string[] }): Promise<OpenLine[]> {
    const where = [
      eq(invoice.familyId, f.familyId),
      eq(invoice.campusId, f.campusId),
      inArray(invoice.status, ['issued', 'partially_paid']),
    ];
    if (f.invoiceIds?.length) where.push(inArray(invoice.id, f.invoiceIds));
    const locked = await this.tx
      .select({ id: invoice.id, dueDate: invoice.dueDate })
      .from(invoice)
      .where(and(...where))
      .orderBy(asc(invoice.id)) // consistent lock order prevents deadlocks
      .for('update');
    if (!locked.length) return [];
    const due = new Map(locked.map((r) => [r.id, r.dueDate]));
    const lines = await this.tx
      .select({
        invoiceId: invoiceLine.invoiceId,
        invoiceLineId: invoiceLine.id,
        priority: invoiceLine.priority,
        outstandingPaisa: sql<number>`(${invoiceLine.netPaisa} - ${invoiceLine.paidPaisa})::bigint`,
      })
      .from(invoiceLine)
      .where(
        and(
          inArray(invoiceLine.invoiceId, [...due.keys()]),
          gt(sql`${invoiceLine.netPaisa} - ${invoiceLine.paidPaisa}`, 0),
        ),
      );
    return lines.map((l) => ({ ...l, outstandingPaisa: Number(l.outstandingPaisa), dueDate: due.get(l.invoiceId)! }));
  }

  async insertPayment(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(payment)
      .values(values as typeof payment.$inferInsert)
      .returning({ id: payment.id });
    return r!.id;
  }

  async insertAllocations(rows: Array<Record<string, unknown>>) {
    if (rows.length)
      await this.tx.insert(paymentAllocation).values(rows as Array<typeof paymentAllocation.$inferInsert>);
  }

  async insertReceipt(values: Record<string, unknown>) {
    await this.tx.insert(receipt).values(values as typeof receipt.$inferInsert);
  }

  familyPayments(familyId: string): Promise<PaymentView[]> {
    return this.tx
      .select({
        id: payment.id,
        paymentNo: payment.paymentNo,
        receiptNo: receipt.receiptNo,
        channel: payment.channel,
        amountPaisa: payment.amountPaisa,
        receivedAt: payment.receivedAt,
        status: payment.status,
      })
      .from(payment)
      .leftJoin(receipt, eq(receipt.paymentId, payment.id))
      .where(eq(payment.familyId, familyId))
      .orderBy(desc(payment.receivedAt));
  }

  async familyCreditPaisa(familyId: string): Promise<number> {
    const [r] = await this.tx
      .select({
        credit: sql<number>`(coalesce(sum(${payment.amountPaisa}), 0)
          - coalesce((SELECT sum(a.amount_paisa) FROM fee.payment_allocation a JOIN fee.payment p2 ON p2.id = a.payment_id
                       WHERE p2.family_id = ${familyId} AND p2.status = 'confirmed'), 0)
          - coalesce((SELECT sum(r.amount_paisa) FROM fee.refund r WHERE r.family_id = ${familyId} AND r.status = 'paid'), 0))::bigint`,
      })
      .from(payment)
      .where(and(eq(payment.familyId, familyId), eq(payment.status, 'confirmed')));
    return Number(r?.credit ?? 0);
  }

  async invoiceNumbers(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.tx
      .select({ id: invoice.id, no: invoice.invoiceNo })
      .from(invoice)
      .where(inArray(invoice.id, ids));
    return new Map(rows.map((r) => [r.id, r.no]));
  }

  // ---------------- cash sessions ----------------
  async openCashSession(userId: string) {
    const [r] = await this.tx
      .select({ id: cashSession.id, campusId: cashSession.campusId, openingFloatPaisa: cashSession.openingFloatPaisa })
      .from(cashSession)
      .where(and(eq(cashSession.cashierUserId, userId), eq(cashSession.status, 'open')));
    return r ?? null;
  }

  async insertCashSession(values: Record<string, unknown>) {
    const [r] = await this.tx
      .insert(cashSession)
      .values(values as typeof cashSession.$inferInsert)
      .returning({ id: cashSession.id });
    return r!;
  }

  async cashSessionForUpdate(id: string) {
    const [r] = await this.tx
      .select({
        id: cashSession.id,
        cashierUserId: cashSession.cashierUserId,
        status: cashSession.status,
        openingFloatPaisa: cashSession.openingFloatPaisa,
      })
      .from(cashSession)
      .where(eq(cashSession.id, id))
      .for('update');
    return r ?? null;
  }

  async cashCollected(sessionId: string): Promise<number> {
    const [r] = await this.tx
      .select({ total: sql<number>`coalesce(sum(${payment.amountPaisa}), 0)::bigint` })
      .from(payment)
      .where(and(eq(payment.cashSessionId, sessionId), eq(payment.channel, 'cash'), eq(payment.status, 'confirmed')));
    return Number(r?.total ?? 0);
  }

  async closeCashSession(id: string, expected: number, counted: number, handedOverTo: string | null, at: Date) {
    await this.tx
      .update(cashSession)
      .set({ expectedCashPaisa: expected, countedCashPaisa: counted, handedOverTo, closedAt: at, status: 'closed' })
      .where(eq(cashSession.id, id));
  }

  // ---------------- billing runs ----------------
  async lockBillingRun(values: {
    orgId: string;
    campusId: string;
    academicYearId: string;
    billingPeriod: string;
  }): Promise<{ id: string; academicYearId: string }> {
    // one run per campus and period (ux_billing_run_period); a re-post joins it as a supplementary pass
    await this.tx
      .insert(billingRun)
      .values({ ...values, status: 'posting' })
      .onConflictDoNothing();
    const [r] = await this.tx
      .select({ id: billingRun.id, academicYearId: billingRun.academicYearId })
      .from(billingRun)
      .where(
        and(
          eq(billingRun.campusId, values.campusId),
          eq(billingRun.billingPeriod, values.billingPeriod),
          ne(billingRun.status, 'cancelled'),
        ),
      )
      .for('update');
    return r!;
  }

  async billingRunForUpdate(id: string) {
    const [r] = await this.tx
      .select({
        id: billingRun.id,
        campusId: billingRun.campusId,
        academicYearId: billingRun.academicYearId,
        billingPeriod: billingRun.billingPeriod,
        status: billingRun.status,
      })
      .from(billingRun)
      .where(eq(billingRun.id, id))
      .for('update');
    return r ?? null;
  }

  async finishBillingRun(id: string, count: number, totalNet: number, postedBy: string, at: Date) {
    await this.tx
      .update(billingRun)
      .set({
        status: 'posted',
        invoiceCount: sql`coalesce(${billingRun.invoiceCount}, 0) + ${count}`,
        totalNetPaisa: sql`coalesce(${billingRun.totalNetPaisa}, 0) + ${totalNet}`,
        postedBy,
        postedAt: at,
      })
      .where(eq(billingRun.id, id));
  }
}
