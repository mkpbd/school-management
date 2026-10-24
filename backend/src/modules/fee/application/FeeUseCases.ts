import { randomBytes } from 'node:crypto';
import type { EventPublisher, NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { EnrolmentSummary, SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import { academicMonthIndex, allocatePayment, buildInvoiceLines } from '../domain/billing.js';
import type { ChargeRequest, ChargeResult } from '../public-api/FeeModuleApi.js';
import type { FeeRepository, InvoiceView, PaymentView, StructureLineInput, StructureView } from './ports.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  feeRepo: FeeRepository;
  scopePolicy: ScopePolicy;
  numbers: NumberAllocator;
  outbox: EventPublisher;
  sisApi: SisModuleApi;
  coreApi: CoreModuleApi;
}

const token = (bytes = 12) => randomBytes(bytes).toString('base64url');
const verificationCode = () => randomBytes(13).toString('base64url').replace(/[-_]/g, 'X').slice(0, 20).toUpperCase();

// ---------------------------------------------------------------------------------------------------------------
// Fee structures (FEE-01)
// ---------------------------------------------------------------------------------------------------------------

export class CreateFeeStructure extends UseCase<
  { campusId?: string; academicYearId: string; yearGroupId: string; name: string; lines: StructureLineInput[] },
  StructureView
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    campusId?: string;
    academicYearId: string;
    yearGroupId: string;
    name: string;
    lines: StructureLineInput[];
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    if (new Set(i.lines.map((l) => l.feeHeadId)).size !== i.lines.length)
      throw new InvariantError('DUPLICATE_FEE_HEAD', 'A fee head appears twice');
    for (const l of i.lines) {
      if (l.billingMonths && l.billingMonths.some((m) => m < 1 || m > 12))
        throw new InvariantError('BILLING_MONTH_INVALID', 'billingMonths are 1-12');
    }
    const id = await this.d.feeRepo.insertStructure(
      { orgId: this.d.ctx.orgId, campusId, academicYearId: i.academicYearId, yearGroupId: i.yearGroupId, name: i.name },
      i.lines,
    );
    return (await this.d.feeRepo.getStructure(id))!;
  }
}

export class ActivateFeeStructure extends UseCase<{ id: string }, StructureView> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const s = await this.d.feeRepo.getStructure(id);
    if (!s) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(s.campusId);
    if (!s.lines.length) throw new InvariantError('STRUCTURE_EMPTY', 'Add fee lines before activating');
    await this.d.feeRepo.activateStructure(id);
    return (await this.d.feeRepo.getStructure(id))!;
  }
}

export class GetFeeStructure extends Query<{ id: string }, StructureView> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const s = await this.d.feeRepo.getStructure(id);
    if (!s) throw new NotFoundError();
    return s;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Concessions (FEE-02)
// ---------------------------------------------------------------------------------------------------------------

export class GrantConcession extends UseCase<
  {
    studentId: string;
    concessionTypeId: string;
    feeHeadId?: string;
    valuePercent?: number;
    valuePaisa?: number;
    validFrom: string;
    validTo: string;
    justification?: string;
  },
  { id: string; status: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    studentId: string;
    concessionTypeId: string;
    feeHeadId?: string;
    valuePercent?: number;
    valuePaisa?: number;
    validFrom: string;
    validTo: string;
    justification?: string;
  }) {
    const brief = (await this.d.sisApi.studentBriefs([i.studentId])).get(i.studentId);
    if (!brief) throw new NotFoundError('Student not found', 'STUDENT_NOT_FOUND');
    this.d.scopePolicy.requireCampus(brief.campusId);
    const type = await this.d.feeRepo.concessionType(i.concessionTypeId);
    if (!type) throw new NotFoundError('Concession type not found');
    if (type.calc === 'percent' && (i.valuePercent === undefined || i.valuePaisa !== undefined)) {
      throw new InvariantError('CONCESSION_VALUE_INVALID', 'Percent concession needs valuePercent only');
    }
    if (type.calc === 'amount' && (i.valuePaisa === undefined || i.valuePercent !== undefined)) {
      throw new InvariantError('CONCESSION_VALUE_INVALID', 'Amount concession needs valuePaisa only');
    }
    return this.d.feeRepo.insertConcession({
      orgId: this.d.ctx.orgId,
      campusId: brief.campusId,
      studentId: i.studentId,
      concessionTypeId: i.concessionTypeId,
      feeHeadId: i.feeHeadId ?? null,
      valuePercent: i.valuePercent !== undefined ? String(i.valuePercent) : null,
      valuePaisa: i.valuePaisa ?? null,
      validFrom: i.validFrom,
      validTo: i.validTo,
      justification: i.justification ?? null,
      status: type.requiresApproval ? 'pending' : 'approved',
    });
  }
}

export class DecideConcession extends UseCase<
  { id: string; decision: 'approved' | 'rejected' },
  { id: string; status: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; decision: 'approved' | 'rejected' }) {
    const c = await this.d.feeRepo.concessionForUpdate(i.id);
    if (!c) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(c.campusId);
    if (c.status !== 'pending') throw new ConflictError('CONCESSION_ALREADY_DECIDED', `Concession is ${c.status}`);
    await this.d.feeRepo.setConcessionStatus(i.id, i.decision);
    return { id: i.id, status: i.decision };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Invoices & billing runs (FEE-03)
// ---------------------------------------------------------------------------------------------------------------

interface PlannedInvoice {
  enrolment: EnrolmentSummary;
  familyId: string;
  dueDate: string;
  lines: ReturnType<typeof buildInvoiceLines>;
  netPaisa: number;
}

/** Plans (and optionally writes) the monthly invoices of a campus. Shared by preview and post. */
async function planInvoices(
  d: Deps,
  campusId: string,
  academicYearId: string,
  period: string,
): Promise<{ planned: PlannedInvoice[]; skipped: Record<string, number> }> {
  const year = await d.coreApi.getYear(academicYearId);
  if (!year) throw new NotFoundError('Academic year not found');
  const monthIndex = academicMonthIndex(year.startsOn, period);
  const periodStart = `${period}-01`;
  const defaultDueDay = (await d.coreApi.getSetting<number>('fee.default_due_day', campusId)) ?? 10;
  const enrolments = await d.sisApi.activeEnrolments({
    campusId,
    academicYearId,
    onDate: LocalDate.parse(periodStart).iso > year.startsOn ? periodStart : year.startsOn,
  });
  const briefs = await d.sisApi.studentBriefs(enrolments.map((e) => e.studentId));
  const structures = new Map<string, Awaited<ReturnType<FeeRepository['activeStructureSources']>>>();
  const skipped: Record<string, number> = { noStructure: 0, alreadyBilled: 0, nothingDue: 0 };
  const planned: PlannedInvoice[] = [];

  for (const e of enrolments) {
    if (!structures.has(e.yearGroupId))
      structures.set(e.yearGroupId, await d.feeRepo.activeStructureSources(campusId, academicYearId, e.yearGroupId));
    const structure = structures.get(e.yearGroupId);
    if (!structure) {
      skipped.noStructure!++;
      continue;
    }
    if (await d.feeRepo.invoiceExistsFor(e.id, period)) {
      skipped.alreadyBilled!++;
      continue;
    }
    const first = !(await d.feeRepo.hasInvoiceInYear(e.id));
    const sources = [...structure.sources, ...(await d.feeRepo.studentItemSources(e.id, periodStart))];
    const lines = buildInvoiceLines({
      sources,
      concessions: await d.feeRepo.approvedConcessions(e.studentId, periodStart),
      monthIndex,
      isNewAdmission: first && e.startsOn > year.startsOn,
      isFirstInvoiceOfYear: first,
      periodLabel: period,
    });
    if (!lines.length) {
      skipped.nothingDue!++;
      continue;
    }
    const dueDay = Math.min(28, structure.dueDay || defaultDueDay);
    planned.push({
      enrolment: e,
      familyId: briefs.get(e.studentId)!.familyId,
      dueDate: `${period}-${String(dueDay).padStart(2, '0')}`,
      lines,
      netPaisa: lines.reduce((s, l) => s + l.amountPaisa - l.discountPaisa, 0),
    });
  }
  return { planned, skipped };
}

async function writeInvoice(
  d: Deps,
  p: {
    campusId: string;
    academicYearId: string;
    familyId: string;
    studentId: string | null;
    enrolmentId: string | null;
    billingRunId?: string | null;
    period: string | null;
    dueDate: string;
    lines: Array<Record<string, unknown>>;
  },
): Promise<InvoiceView> {
  const today = LocalDate.today(d.clock).iso;
  const invoiceId = await d.feeRepo.insertInvoice({
    orgId: d.ctx.orgId,
    campusId: p.campusId,
    academicYearId: p.academicYearId,
    invoiceNo: await d.numbers.next({ campusId: p.campusId, key: 'invoice' }),
    familyId: p.familyId,
    studentId: p.studentId,
    enrolmentId: p.enrolmentId,
    billingRunId: p.billingRunId ?? null,
    billingPeriod: p.period,
    issueDate: today < p.dueDate ? today : p.dueDate,
    dueDate: p.dueDate,
    payToken: token(),
  });
  await d.feeRepo.insertInvoiceLines(invoiceId, d.ctx.orgId, p.campusId, p.lines);
  const invoice = await d.feeRepo.issueInvoice(invoiceId); // trigger computes totals; zero net -> paid
  await d.outbox.write([
    {
      type: 'fee.invoice_issued.v1',
      aggregateType: 'invoice',
      aggregateId: invoice.id,
      orgId: d.ctx.orgId,
      campusId: p.campusId,
      occurredAt: d.clock.now(),
      payload: {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        familyId: p.familyId,
        studentId: p.studentId,
        netPaisa: invoice.netPaisa,
        dueDate: p.dueDate,
        payToken: invoice.payToken,
      },
    },
  ]);
  return invoice;
}

export class PreviewBilling extends Query<
  { campusId?: string; academicYearId: string; period: string },
  {
    invoices: number;
    totalNetPaisa: number;
    skipped: Record<string, number>;
    sample: Array<{ studentId: string; netPaisa: number; lines: number }>;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; academicYearId: string; period: string }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const { planned, skipped } = await planInvoices(this.d, campusId, i.academicYearId, i.period);
    return {
      invoices: planned.length,
      totalNetPaisa: planned.reduce((s, p) => s + p.netPaisa, 0),
      skipped,
      sample: planned
        .slice(0, 20)
        .map((p) => ({ studentId: p.enrolment.studentId, netPaisa: p.netPaisa, lines: p.lines.length })),
    };
  }
}

/**
 * Posts a billing run: one invoice per active enrolment. Re-posting the period joins the same run and only bills
 * enrolments without an invoice yet (late admissions); ux_invoice_period is the database backstop.
 */
export class PostBillingRun extends UseCase<
  { campusId?: string; academicYearId: string; period: string },
  { billingRunId: string; invoices: number; totalNetPaisa: number; skipped: Record<string, number> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { campusId?: string; academicYearId: string; period: string }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const billingRun = await this.d.feeRepo.lockBillingRun({
      orgId: this.d.ctx.orgId,
      campusId,
      academicYearId: i.academicYearId,
      billingPeriod: i.period,
    });
    if (billingRun.academicYearId !== i.academicYearId)
      throw new ConflictError('BILLING_PERIOD_OTHER_YEAR', `Period ${i.period} was billed under another academic year`);
    const runId = billingRun.id;
    const { planned, skipped } = await planInvoices(this.d, campusId, i.academicYearId, i.period);
    let total = 0;
    for (const p of planned) {
      const inv = await writeInvoice(this.d, {
        campusId,
        academicYearId: i.academicYearId,
        familyId: p.familyId,
        studentId: p.enrolment.studentId,
        enrolmentId: p.enrolment.id,
        billingRunId: runId,
        period: i.period,
        dueDate: p.dueDate,
        lines: p.lines.map((l) => ({ ...l })),
      });
      total += inv.netPaisa;
    }
    await this.d.feeRepo.finishBillingRun(runId, planned.length, total, this.d.ctx.userId!, this.d.clock.now());
    return { billingRunId: runId, invoices: planned.length, totalNetPaisa: total, skipped };
  }
}

export class CreateAdhocInvoice extends UseCase<
  { studentId: string; dueDate: string; lines: Array<{ feeHeadId: string; description: string; amountPaisa: number }> },
  InvoiceView
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    studentId: string;
    dueDate: string;
    lines: Array<{ feeHeadId: string; description: string; amountPaisa: number }>;
  }) {
    const brief = (await this.d.sisApi.studentBriefs([i.studentId])).get(i.studentId);
    if (!brief) throw new NotFoundError('Student not found', 'STUDENT_NOT_FOUND');
    this.d.scopePolicy.requireCampus(brief.campusId);
    const enrolment = await this.d.sisApi.activeEnrolment(i.studentId, LocalDate.today(this.d.clock).iso);
    const year = enrolment
      ? await this.d.coreApi.getYear(enrolment.academicYearId)
      : await this.d.coreApi.yearFor(LocalDate.today(this.d.clock).iso);
    if (!year) throw new InvariantError('NO_ACADEMIC_YEAR', 'No academic year covers today');
    return writeInvoice(this.d, {
      campusId: brief.campusId,
      academicYearId: year.id,
      familyId: brief.familyId,
      studentId: i.studentId,
      enrolmentId: enrolment?.id ?? null,
      period: null,
      dueDate: i.dueDate,
      lines: i.lines.map((l, n) => ({
        ...l,
        discountPaisa: 0,
        source: 'adhoc',
        sourceRef: `adhoc-${n}`,
        priority: 100,
      })),
    });
  }
}

export class VoidInvoice extends UseCase<{ id: string; reason: string }, InvoiceView> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; reason: string }) {
    const inv = await this.d.feeRepo.getInvoice(i.id, false);
    if (!inv) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(inv.campusId);
    if (inv.status === 'void') throw new ConflictError('INVOICE_ALREADY_VOID', 'Invoice is already void');
    if (inv.paidPaisa > 0)
      throw new ConflictError('INVOICE_HAS_PAYMENTS', 'Reverse the allocated payments before voiding this invoice');
    await this.d.feeRepo.voidInvoice(i.id, i.reason); // DB trigger enforces the same rule under concurrency
    return (await this.d.feeRepo.getInvoice(i.id, true))!;
  }
}

/**
 * One-off charge raised by another module (LIB fine, POS on account): one issued invoice with one line, idempotent
 * per source + sourceRef. Called through FeeModuleApi inside the caller's transaction; the caller checks permissions.
 */
export class RaiseCharge extends UseCase<ChargeRequest, ChargeResult> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: ChargeRequest): Promise<ChargeResult> {
    if (!Number.isSafeInteger(i.amountPaisa) || i.amountPaisa <= 0)
      throw new InvariantError('AMOUNT_INVALID', 'Charge must be a positive number of paisa');
    const existing = await this.d.feeRepo.chargeLine(i.source, i.sourceRef);
    if (existing)
      return {
        invoiceId: existing.invoiceId,
        invoiceNo: existing.invoiceNo,
        invoiceLineId: existing.lineId,
        created: false,
      };
    const head = await this.d.feeRepo.feeHeadByCode(i.feeHeadCode);
    if (!head) throw new InvariantError('FEE_HEAD_MISSING', `Fee head ${i.feeHeadCode} is not configured`);
    const brief = (await this.d.sisApi.studentBriefs([i.studentId])).get(i.studentId);
    if (!brief) throw new NotFoundError('Student not found', 'STUDENT_NOT_FOUND');
    const today = LocalDate.today(this.d.clock);
    const enrolment = await this.d.sisApi.activeEnrolment(i.studentId, today.iso);
    const year = enrolment
      ? await this.d.coreApi.getYear(enrolment.academicYearId)
      : await this.d.coreApi.yearFor(today.iso);
    if (!year) throw new InvariantError('NO_ACADEMIC_YEAR', 'No academic year covers today');
    const dueDays = (await this.d.coreApi.getSetting<number>('fee.charge_due_days', brief.campusId)) ?? 7;
    const inv = await writeInvoice(this.d, {
      campusId: brief.campusId,
      academicYearId: year.id,
      familyId: brief.familyId,
      studentId: i.studentId,
      enrolmentId: enrolment?.id ?? null,
      period: null,
      dueDate: i.dueDate ?? today.addDays(dueDays).iso,
      lines: [
        {
          feeHeadId: head.id,
          description: i.description,
          amountPaisa: i.amountPaisa,
          discountPaisa: 0,
          source: i.source,
          sourceRef: i.sourceRef,
          priority: head.priority,
        },
      ],
    });
    const line = (await this.d.feeRepo.getInvoice(inv.id, true))!.lines![0]!;
    return { invoiceId: inv.id, invoiceNo: inv.invoiceNo, invoiceLineId: line.id, created: true };
  }
}

async function assertFamilyAccess(d: Deps, familyId: string, invoiceCampusId?: string): Promise<void> {
  if (d.ctx.userType === 'guardian') {
    const children = d.ctx.guardianId ? await d.sisApi.childrenOfGuardian(d.ctx.guardianId) : [];
    const families = new Set([...(await d.sisApi.studentBriefs(children)).values()].map((b) => b.familyId));
    if (!families.has(familyId)) throw new NotFoundError();
    return;
  }
  d.scopePolicy.grantsFor('fee.invoice.view');
  if (invoiceCampusId && d.ctx.campusIds !== '*' && !d.ctx.campusIds.includes(invoiceCampusId))
    throw new ForbiddenError('OUT_OF_SCOPE');
}

export class GetInvoice extends Query<{ id: string }, InvoiceView> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const inv = await this.d.feeRepo.getInvoice(id, true);
    if (!inv) throw new NotFoundError();
    await assertFamilyAccess(this.d, inv.familyId, inv.campusId);
    return inv;
  }
}

export class ListInvoices extends Query<
  {
    familyId?: string;
    studentId?: string;
    campusId?: string;
    status?: string;
    period?: string;
    overdue?: boolean;
    limit: number;
    offset: number;
  },
  InvoiceView[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    familyId?: string;
    studentId?: string;
    campusId?: string;
    status?: string;
    period?: string;
    overdue?: boolean;
    limit: number;
    offset: number;
  }) {
    if (this.d.ctx.userType === 'guardian') {
      if (!i.familyId) throw new InvariantError('FAMILY_REQUIRED', 'familyId is required');
      await assertFamilyAccess(this.d, i.familyId);
    } else {
      this.d.scopePolicy.grantsFor('fee.invoice.view');
    }
    return this.d.feeRepo.listInvoices({ ...i, overdueOn: i.overdue ? LocalDate.today(this.d.clock).iso : undefined });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Payments, receipts, cash sessions (FEE-05, FEE-06)
// ---------------------------------------------------------------------------------------------------------------

export interface CounterPaymentResult {
  paymentId: string;
  paymentNo: string;
  receiptNo: string;
  verificationCode: string;
  amountPaisa: number;
  allocatedPaisa: number;
  creditPaisa: number;
  allocations: Array<{ invoiceId: string; invoiceNo: string; amountPaisa: number }>;
}

/**
 * FEE-05 counter collection: locks the family's open invoices (id order, deadlock-safe), allocates oldest due first,
 * numbers the payment and receipt gap-free, and emits fee.payment_received (receipt SMS via COM).
 * Over-allocation is impossible: the DB CHECK on invoice_line.paid <= net is the last line of defence.
 */
export class RecordCounterPayment extends UseCase<
  {
    campusId?: string;
    familyId: string;
    invoiceIds?: string[];
    amountPaisa: number;
    channel: 'cash' | 'cheque' | 'pos_card' | 'bank_deposit';
    payerGuardianId?: string;
    instrument?: Record<string, unknown>;
    notes?: string;
  },
  CounterPaymentResult
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    campusId?: string;
    familyId: string;
    invoiceIds?: string[];
    amountPaisa: number;
    channel: 'cash' | 'cheque' | 'pos_card' | 'bank_deposit';
    payerGuardianId?: string;
    instrument?: Record<string, unknown>;
    notes?: string;
  }) {
    const { ctx, feeRepo, numbers, clock } = this.d;
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    let cashSessionId: string | null = null;
    if (i.channel === 'cash') {
      const session = await feeRepo.openCashSession(ctx.userId!);
      if (!session) throw new ConflictError('CASH_SESSION_REQUIRED', 'Open a cash session before collecting cash');
      if (session.campusId !== campusId)
        throw new ConflictError('CASH_SESSION_OTHER_CAMPUS', 'Your open cash session is for another campus');
      cashSessionId = session.id;
    }
    const lines = await feeRepo.lockOpenLines({ familyId: i.familyId, campusId, invoiceIds: i.invoiceIds });
    if (i.invoiceIds?.length) {
      const found = new Set(lines.map((l) => l.invoiceId));
      if (i.invoiceIds.some((id) => !found.has(id)))
        throw new InvariantError(
          'INVOICE_NOT_PAYABLE',
          'An invoice is not open, not in this family or not on this campus',
        );
    }
    const { allocations, remainderPaisa } = allocatePayment(i.amountPaisa, lines);

    const paymentNo = await numbers.next({ campusId, key: 'payment' });
    const receiptNo = await numbers.next({ campusId, key: 'receipt' });
    const paymentId = await feeRepo.insertPayment({
      orgId: ctx.orgId,
      campusId,
      paymentNo,
      familyId: i.familyId,
      payerGuardianId: i.payerGuardianId ?? null,
      channel: i.channel,
      amountPaisa: i.amountPaisa,
      valueDate: LocalDate.today(clock).iso,
      status: 'confirmed',
      instrument: i.instrument ?? null,
      cashSessionId,
      collectedBy: ctx.userId,
      notes: i.notes ?? null,
    });
    await feeRepo.insertAllocations(
      allocations.map((a) => ({
        orgId: ctx.orgId,
        campusId,
        paymentId,
        invoiceId: a.invoiceId,
        invoiceLineId: a.invoiceLineId,
        amountPaisa: a.amountPaisa,
        allocatedBy: ctx.userId,
      })),
    );
    const code = verificationCode();
    await feeRepo.insertReceipt({ orgId: ctx.orgId, campusId, receiptNo, paymentId, verificationCode: code });
    await this.d.outbox.write([
      {
        type: 'fee.payment_received.v1',
        aggregateType: 'payment',
        aggregateId: paymentId,
        orgId: ctx.orgId,
        campusId,
        occurredAt: clock.now(),
        payload: { paymentId, familyId: i.familyId, receiptNo, amountPaisa: i.amountPaisa, channel: i.channel },
      },
    ]);
    const invoiceNos = await feeRepo.invoiceNumbers([...new Set(allocations.map((a) => a.invoiceId))]);
    const byInvoice = new Map<string, number>();
    for (const a of allocations) byInvoice.set(a.invoiceId, (byInvoice.get(a.invoiceId) ?? 0) + a.amountPaisa);
    return {
      paymentId,
      paymentNo,
      receiptNo,
      verificationCode: code,
      amountPaisa: i.amountPaisa,
      allocatedPaisa: i.amountPaisa - remainderPaisa,
      creditPaisa: remainderPaisa,
      allocations: [...byInvoice.entries()].map(([invoiceId, amountPaisa]) => ({
        invoiceId,
        invoiceNo: invoiceNos.get(invoiceId) ?? '',
        amountPaisa,
      })),
    };
  }
}

export class OpenCashSession extends UseCase<{ campusId?: string; openingFloatPaisa: number }, { id: string }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; openingFloatPaisa: number }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    if (await this.d.feeRepo.openCashSession(this.d.ctx.userId!))
      throw new ConflictError('CASH_SESSION_OPEN', 'You already have an open cash session');
    return this.d.feeRepo.insertCashSession({
      orgId: this.d.ctx.orgId,
      campusId,
      cashierUserId: this.d.ctx.userId,
      openingFloatPaisa: i.openingFloatPaisa,
    });
  }
}

export class CloseCashSession extends UseCase<
  { id: string; countedCashPaisa: number; handedOverTo?: string },
  { expectedCashPaisa: number; countedCashPaisa: number; variancePaisa: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; countedCashPaisa: number; handedOverTo?: string }) {
    const s = await this.d.feeRepo.cashSessionForUpdate(i.id);
    if (!s) throw new NotFoundError();
    if (s.cashierUserId !== this.d.ctx.userId && !this.d.scopePolicy.has('fee.cash_session.approve'))
      throw new ForbiddenError();
    if (s.status !== 'open') throw new ConflictError('CASH_SESSION_CLOSED', 'Session is already closed');
    const expected = s.openingFloatPaisa + (await this.d.feeRepo.cashCollected(s.id));
    await this.d.feeRepo.closeCashSession(
      s.id,
      expected,
      i.countedCashPaisa,
      i.handedOverTo ?? null,
      this.d.clock.now(),
    );
    return {
      expectedCashPaisa: expected,
      countedCashPaisa: i.countedCashPaisa,
      variancePaisa: i.countedCashPaisa - expected,
    };
  }
}

export interface FamilyStatement {
  familyId: string;
  invoices: InvoiceView[];
  payments: PaymentView[];
  totals: { netPaisa: number; paidPaisa: number; outstandingPaisa: number; overduePaisa: number; creditPaisa: number };
}

/** FEE-06 family-wise statement (all campuses of the family the caller may see); guardians: own family only. */
export class GetFamilyStatement extends Query<{ familyId: string }, FamilyStatement> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ familyId }: { familyId: string }) {
    await assertFamilyAccess(this.d, familyId);
    const invoices = (await this.d.feeRepo.listInvoices({ familyId, limit: 500, offset: 0 })).filter(
      (x) => x.status !== 'void' && x.status !== 'draft',
    );
    const payments = await this.d.feeRepo.familyPayments(familyId);
    const today = LocalDate.today(this.d.clock).iso;
    return {
      familyId,
      invoices,
      payments,
      totals: {
        netPaisa: invoices.reduce((s, x) => s + x.netPaisa, 0),
        paidPaisa: invoices.reduce((s, x) => s + x.paidPaisa, 0),
        outstandingPaisa: invoices.reduce((s, x) => s + x.outstandingPaisa, 0),
        overduePaisa: invoices.filter((x) => x.dueDate < today).reduce((s, x) => s + x.outstandingPaisa, 0),
        creditPaisa: await this.d.feeRepo.familyCreditPaisa(familyId),
      },
    };
  }
}
