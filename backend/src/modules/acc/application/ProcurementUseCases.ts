import type { EventPublisher, NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { InvModuleApi } from '../../inv/public-api/InvModuleApi.js';
import type { EntryLine } from '../domain/journal.js';
import {
  applyReceipt,
  assertSelectable,
  budgetKey,
  findOverruns,
  lineAmount,
  matchBill,
  rankQuotations,
  requiredQuotations,
  withholding,
  type Overrun,
} from '../domain/procurement.js';
import { postJournal } from './AccountingUseCases.js';
import { budgetPositions } from './BudgetUseCases.js';
import type { AccRepository } from './ports.js';
import type {
  BillRow,
  PaymentRow,
  PoRow,
  ProcurementRepository,
  QuotationRow,
  ReceiptRow,
  RequisitionRow,
  VendorRow,
  VendorStats,
} from './procurementPorts.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  procRepo: ProcurementRepository;
  accRepo: AccRepository;
  numbers: NumberAllocator;
  scopePolicy: ScopePolicy;
  coreApi: CoreModuleApi;
  outbox: EventPublisher;
  poPdf: PurchaseOrderPdfRenderer;
  invApi: InvModuleApi;
}

/** Stock items on purchase lines must be known, active variants. */
async function assertVariants(d: Deps, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return;
  const found = await d.invApi.variants(wanted);
  for (const id of wanted)
    if (!found.get(id)?.isActive) throw new InvariantError('ITEM_UNKNOWN', 'Unknown or inactive stock item');
}

export interface PurchaseOrderDocument {
  schoolName: string;
  campusName: string;
  poNo: string;
  status: PoRow['status'];
  orderDate: string;
  expectedOn: string | null;
  requisitionNo: string | null;
  terms: string | null;
  issuedByName: string | null;
  totalPaisa: number;
  vendor: Pick<VendorRow, 'name' | 'address' | 'phone' | 'email' | 'binVat' | 'tin' | 'paymentTermsDays'>;
  lines: Array<{ description: string; quantity: number; unitPaisa: number }>;
}

export interface PurchaseOrderPdfRenderer {
  render(po: PurchaseOrderDocument): Promise<Buffer>;
}

interface ProcurementAccounts {
  payable: string;
  vat: string;
  tds: string;
  bank: string;
  cash: string;
  mobile: string;
}
const DEFAULT_ACCOUNTS: ProcurementAccounts = {
  payable: '2300',
  vat: '2130',
  tds: '2120',
  bank: '1110',
  cash: '1100',
  mobile: '1120',
};

async function procurementAccounts(d: Deps, campusId: string): Promise<ProcurementAccounts> {
  const custom = (await d.coreApi.getSetting<Partial<ProcurementAccounts>>('acc.procurement_accounts', campusId)) ?? {};
  return { ...DEFAULT_ACCOUNTS, ...custom };
}

const today = (d: Deps) => LocalDate.today(d.clock).iso;

/** Requested amounts per account x cost centre, and the overruns against the approved budget. */
async function budgetCheck(
  d: Deps,
  campusId: string,
  date: string,
  costCentreId: string | null,
  lines: Array<{ accountId: string | null; amountPaisa: number }>,
): Promise<{ overruns: Array<Overrun & { accountCode: string }>; budgetId: string | null }> {
  const requested = new Map<string, number>();
  for (const l of lines) {
    if (!l.accountId) throw new InvariantError('ACCOUNT_REQUIRED', 'Every line needs an expense account');
    const k = budgetKey(l.accountId, costCentreId);
    requested.set(k, (requested.get(k) ?? 0) + l.amountPaisa);
  }
  const { budget, positions } = await budgetPositions(d, campusId, date);
  const overruns = findOverruns(requested, positions);
  const accounts = await d.procRepo.accounts(overruns.map((o) => o.key.split('|')[0]!));
  return {
    budgetId: budget?.id ?? null,
    overruns: overruns.map((o) => ({ ...o, accountCode: accounts.get(o.key.split('|')[0]!)?.code ?? '' })),
  };
}

// ------------------------------------------------------------------------------------------------------------------
// vendors (ACC-05)
// ------------------------------------------------------------------------------------------------------------------

export interface VendorInput {
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tin?: string | null;
  binVat?: string | null;
  tdsRatePct?: number | null;
  vatRatePct?: number | null;
  paymentTermsDays?: number;
  performanceNote?: string | null;
  isActive?: boolean;
}

const vendorValues = (i: Partial<VendorInput>) => {
  const out: Record<string, unknown> = { ...i };
  if (i.tdsRatePct !== undefined) out.tdsRatePct = i.tdsRatePct === null ? null : String(i.tdsRatePct);
  if (i.vatRatePct !== undefined) out.vatRatePct = i.vatRatePct === null ? null : String(i.vatRatePct);
  return out;
};

export class CreateVendor extends UseCase<VendorInput, VendorRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: VendorInput) {
    const id = await this.d.procRepo.insertVendor({
      ...vendorValues(i),
      code: i.code.toUpperCase(),
      orgId: this.d.ctx.orgId,
    });
    return (await this.d.procRepo.vendor(id))!;
  }
}

export class UpdateVendor extends UseCase<{ id: string } & Partial<Omit<VendorInput, 'code'>>, VendorRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id, ...patch }: { id: string } & Partial<Omit<VendorInput, 'code'>>) {
    if (!(await this.d.procRepo.vendor(id))) throw new NotFoundError('Vendor not found', 'VENDOR_NOT_FOUND');
    await this.d.procRepo.updateVendor(id, vendorValues(patch));
    return (await this.d.procRepo.vendor(id))!;
  }
}

export class ListVendors extends Query<{ q?: string; active?: boolean }, VendorRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { q?: string; active?: boolean }) {
    return this.d.procRepo.vendors(i);
  }
}

/** Supplier master with performance: orders, on-time deliveries, average rating, billed and outstanding. */
export class GetVendor extends Query<{ id: string }, VendorRow & { performance: VendorStats }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const v = await this.d.procRepo.vendor(id);
    if (!v) throw new NotFoundError('Vendor not found', 'VENDOR_NOT_FOUND');
    return { ...v, performance: await this.d.procRepo.vendorStats(id) };
  }
}

// ------------------------------------------------------------------------------------------------------------------
// requisitions and quotations (ACC-04)
// ------------------------------------------------------------------------------------------------------------------

const estTotal = (r: RequisitionRow) =>
  (r.lines ?? []).reduce((s, l) => s + lineAmount(l.quantity, l.estUnitPaisa ?? 0), 0);

/** A department asks to buy; lines carry the expense account, the requisition a cost centre (budget line). */
export class CreateRequisition extends UseCase<
  {
    campusId?: string;
    title: string;
    costCentreId: string;
    departmentId?: string;
    neededBy?: string;
    justification?: string;
    lines: Array<{
      description: string;
      quantity: number;
      estUnitPaisa: number;
      accountId: string;
      itemVariantId?: string;
    }>;
    submit?: boolean;
  },
  RequisitionRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    campusId?: string;
    title: string;
    costCentreId: string;
    departmentId?: string;
    neededBy?: string;
    justification?: string;
    lines: Array<{
      description: string;
      quantity: number;
      estUnitPaisa: number;
      accountId: string;
      itemVariantId?: string;
    }>;
    submit?: boolean;
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    await assertVariants(
      this.d,
      i.lines.map((l) => l.itemVariantId),
    );
    if (!(await this.d.procRepo.costCentre(i.costCentreId))?.isActive)
      throw new InvariantError('COST_CENTRE_UNKNOWN', 'Unknown or inactive cost centre');
    const accounts = await this.d.procRepo.accounts([...new Set(i.lines.map((l) => l.accountId))]);
    for (const l of i.lines) {
      const a = accounts.get(l.accountId);
      if (!a || a.kind !== 'expense' || !a.isPostable || !a.isActive)
        throw new InvariantError('ACCOUNT_NOT_EXPENSE', 'Requisition lines need an active postable expense account');
    }
    const now = this.d.clock.now();
    const id = await this.d.procRepo.insertRequisition(
      {
        orgId: this.d.ctx.orgId,
        campusId,
        prNo: await this.d.numbers.next({ campusId, key: 'requisition', date: now }),
        title: i.title,
        costCentreId: i.costCentreId,
        departmentId: i.departmentId ?? null,
        requestedBy: this.d.ctx.userId,
        neededBy: i.neededBy ?? null,
        justification: i.justification ?? null,
        status: i.submit ? 'submitted' : 'draft',
        submittedAt: i.submit ? now : null,
      },
      i.lines.map((l, n) => ({
        lineNo: n + 1,
        description: l.description,
        quantity: String(l.quantity),
        estUnitPaisa: l.estUnitPaisa,
        accountId: l.accountId,
        itemVariantId: l.itemVariantId ?? null,
      })),
    );
    return (await this.d.procRepo.requisition(id))!;
  }
}

async function ownOrManage(d: Deps, r: RequisitionRow): Promise<void> {
  if (r.requestedBy === d.ctx.userId) return;
  if (await d.scopePolicy.allows('acc.procurement.view', { campusId: r.campusId })) return;
  throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
}

export class SubmitRequisition extends UseCase<{ id: string }, RequisitionRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.procRepo.requisition(id, true);
    if (!r || r.requestedBy !== this.d.ctx.userId)
      throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    if (r.status !== 'draft' && r.status !== 'rejected')
      throw new InvariantError('REQUISITION_NOT_DRAFT', `The requisition is ${r.status}`);
    await this.d.procRepo.setRequisition(id, { status: 'submitted', submittedAt: this.d.clock.now() });
    return (await this.d.procRepo.requisition(id))!;
  }
}

/**
 * Approval (maker-checker). Spending beyond what the budget line has left — or with no budget line — is refused
 * unless the approver also holds budget approval and records an overrun reason.
 */
export class DecideRequisition extends UseCase<
  { id: string; decision: 'approved' | 'rejected'; note?: string; overrunReason?: string },
  RequisitionRow & { overruns: Array<Overrun & { accountCode: string }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { id: string; decision: 'approved' | 'rejected'; note?: string; overrunReason?: string }) {
    const r = await this.d.procRepo.requisition(i.id, true);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.approve', { campusId: r.campusId });
    if (r.status !== 'submitted')
      throw new InvariantError('REQUISITION_NOT_SUBMITTED', `The requisition is ${r.status}`);
    if (r.requestedBy === this.d.ctx.userId)
      throw new InvariantError('SELF_APPROVAL', 'A requisition must be approved by someone other than the requester');

    let overruns: Array<Overrun & { accountCode: string }> = [];
    const patch: Record<string, unknown> = {
      status: i.decision,
      decidedBy: this.d.ctx.userId,
      decidedAt: this.d.clock.now(),
      decisionNote: i.note ?? null,
    };
    if (i.decision === 'approved') {
      overruns = (
        await budgetCheck(
          this.d,
          r.campusId,
          today(this.d),
          r.costCentreId,
          (r.lines ?? []).map((l) => ({
            accountId: l.accountId,
            amountPaisa: lineAmount(l.quantity, l.estUnitPaisa ?? 0),
          })),
        )
      ).overruns;
      if (overruns.length) {
        const canOverrun = await this.d.scopePolicy.allows('acc.budget.approve', { campusId: r.campusId });
        if (!canOverrun || !i.overrunReason?.trim())
          throw new InvariantError(
            'BUDGET_EXCEEDED',
            canOverrun
              ? 'The requisition exceeds the budget; give an overrun reason to approve it'
              : 'The requisition exceeds the budget; someone with budget approval must approve the overrun',
            { overruns },
            true,
          );
        Object.assign(patch, {
          overBudget: true,
          overrunReason: i.overrunReason.trim(),
          overrunApprovedBy: this.d.ctx.userId,
        });
      }
    }
    await this.d.procRepo.setRequisition(r.id, patch);
    await this.d.outbox.write([
      {
        type: 'acc.requisition_decided.v1',
        aggregateType: 'purchase_requisition',
        aggregateId: r.id,
        orgId: this.d.ctx.orgId,
        campusId: r.campusId,
        occurredAt: this.d.clock.now(),
        payload: {
          requisitionId: r.id,
          prNo: r.prNo,
          title: r.title ?? r.prNo,
          requestedBy: r.requestedBy,
          decision: i.decision,
          note: i.note ?? null,
          overBudget: overruns.length > 0,
        },
      },
    ]);
    return { ...(await this.d.procRepo.requisition(r.id))!, overruns };
  }
}

export class CancelRequisition extends UseCase<{ id: string }, RequisitionRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.procRepo.requisition(id, true);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    if (r.requestedBy !== this.d.ctx.userId)
      await this.d.scopePolicy.assert('acc.procurement.approve', { campusId: r.campusId });
    if (r.status === 'ordered' || r.status === 'closed' || r.status === 'cancelled')
      throw new InvariantError('REQUISITION_CLOSED', `The requisition is ${r.status}`);
    await this.d.procRepo.setRequisition(id, { status: 'cancelled' });
    return (await this.d.procRepo.requisition(id))!;
  }
}

export class ListRequisitions extends Query<{ status?: string; mine?: boolean }, RequisitionRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { status?: string; mine?: boolean }) {
    const manage = this.d.scopePolicy.has('acc.procurement.view');
    if (!manage && !this.d.scopePolicy.has('acc.requisition.view'))
      throw new ForbiddenError('FORBIDDEN', 'Missing permission acc.requisition.view');
    return this.d.procRepo.requisitions({
      status: i.status,
      campusId: this.d.ctx.activeCampusId,
      requestedBy: i.mine || !manage ? this.d.ctx.userId! : undefined,
    });
  }
}

type RankedQuote = ReturnType<typeof rankQuotations<QuotationRow>>[number];

/** Requisition with its lines, the quotation comparison and (while undecided) the budget check. */
export class GetRequisition extends Query<
  { id: string },
  RequisitionRow & {
    estimatedPaisa: number;
    quotationsRequired: number;
    quotations: RankedQuote[];
    budgetCheck: { budgetId: string | null; overruns: Array<Overrun & { accountCode: string }> } | null;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.procRepo.requisition(id);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    await ownOrManage(this.d, r);
    const estimatedPaisa = estTotal(r);
    return {
      ...r,
      estimatedPaisa,
      quotationsRequired: await quotationsRequired(this.d, r.campusId, estimatedPaisa),
      quotations: rankQuotations(await this.d.procRepo.quotations(id), today(this.d)),
      budgetCheck:
        r.status === 'submitted' || r.status === 'draft'
          ? await budgetCheck(
              this.d,
              r.campusId,
              today(this.d),
              r.costCentreId,
              (r.lines ?? []).map((l) => ({
                accountId: l.accountId,
                amountPaisa: lineAmount(l.quantity, l.estUnitPaisa ?? 0),
              })),
            )
          : null,
    };
  }
}

async function quotationsRequired(d: Deps, campusId: string, totalPaisa: number): Promise<number> {
  const threshold = (await d.coreApi.getSetting<number>('acc.quotation_threshold_paisa', campusId)) ?? 2_500_000;
  const minimum = (await d.coreApi.getSetting<number>('acc.min_quotations', campusId)) ?? 3;
  return requiredQuotations(totalPaisa, threshold, minimum);
}

export class AddQuotation extends UseCase<
  {
    requisitionId: string;
    vendorId: string;
    totalPaisa: number;
    validUntil?: string;
    deliveryDays?: number;
    quoteRef?: string;
    note?: string;
    fileId?: string;
  },
  QuotationRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    requisitionId: string;
    vendorId: string;
    totalPaisa: number;
    validUntil?: string;
    deliveryDays?: number;
    quoteRef?: string;
    note?: string;
    fileId?: string;
  }) {
    const r = await this.d.procRepo.requisition(i.requisitionId, true);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.create', { campusId: r.campusId });
    if (r.status !== 'approved')
      throw new InvariantError('REQUISITION_NOT_APPROVED', 'Quotations are collected for approved requisitions');
    const v = await this.d.procRepo.vendor(i.vendorId);
    if (!v?.isActive) throw new InvariantError('VENDOR_INACTIVE', 'Unknown or inactive vendor');
    const id = await this.d.procRepo.insertQuotation({
      orgId: this.d.ctx.orgId,
      campusId: r.campusId,
      requisitionId: r.id,
      vendorId: v.id,
      totalPaisa: i.totalPaisa,
      validUntil: i.validUntil ?? null,
      deliveryDays: i.deliveryDays ?? null,
      quoteRef: i.quoteRef ?? null,
      note: i.note ?? null,
      fileId: i.fileId ?? null,
    });
    return (await this.d.procRepo.quotations(r.id)).find((q) => q.id === id)!;
  }
}

/** Comparison decision: enough valid quotes, and a written reason when the cheapest is not chosen. */
export class SelectQuotation extends UseCase<
  { quotationId: string; requisitionId: string; reason?: string },
  RankedQuote[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { quotationId: string; requisitionId: string; reason?: string }) {
    const r = await this.d.procRepo.requisition(i.requisitionId, true);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.approve', { campusId: r.campusId });
    if (r.status !== 'approved') throw new InvariantError('REQUISITION_NOT_APPROVED', `The requisition is ${r.status}`);
    const ranked = rankQuotations(await this.d.procRepo.quotations(r.id), today(this.d));
    assertSelectable(ranked, i.quotationId, await quotationsRequired(this.d, r.campusId, estTotal(r)), i.reason);
    await this.d.procRepo.selectQuotation(r.id, i.quotationId, i.reason?.trim() || null);
    return rankQuotations(await this.d.procRepo.quotations(r.id), today(this.d));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// purchase orders, goods receipt, bills, payments (ACC-04)
// ------------------------------------------------------------------------------------------------------------------

/** PO from the selected quotation; its total must equal the quoted price, and it must still fit the budget. */
export class IssuePurchaseOrder extends UseCase<
  {
    requisitionId: string;
    orderDate?: string;
    expectedOn?: string;
    terms?: string;
    lines: Array<{
      description: string;
      quantity: number;
      unitPaisa: number;
      accountId: string;
      itemVariantId?: string;
    }>;
  },
  PoRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    requisitionId: string;
    orderDate?: string;
    expectedOn?: string;
    terms?: string;
    lines: Array<{
      description: string;
      quantity: number;
      unitPaisa: number;
      accountId: string;
      itemVariantId?: string;
    }>;
  }) {
    const r = await this.d.procRepo.requisition(i.requisitionId, true);
    if (!r) throw new NotFoundError('Requisition not found', 'REQUISITION_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.create', { campusId: r.campusId });
    if (r.status !== 'approved') throw new InvariantError('REQUISITION_NOT_APPROVED', `The requisition is ${r.status}`);
    await assertVariants(
      this.d,
      i.lines.map((l) => l.itemVariantId),
    );
    const selected = (await this.d.procRepo.quotations(r.id)).find((q) => q.isSelected);
    if (!selected) throw new InvariantError('QUOTATION_NOT_SELECTED', 'Select a quotation first');
    const total = i.lines.reduce((s, l) => s + lineAmount(l.quantity, l.unitPaisa), 0);
    if (total !== selected.totalPaisa)
      throw new InvariantError(
        'QUOTATION_MISMATCH',
        `Order total ${total} differs from the selected quotation ${selected.totalPaisa} (paisa)`,
      );
    const orderDate = i.orderDate ?? today(this.d);
    if (!r.overBudget) {
      const { overruns } = await budgetCheck(
        this.d,
        r.campusId,
        orderDate,
        r.costCentreId,
        i.lines.map((l) => ({ accountId: l.accountId, amountPaisa: lineAmount(l.quantity, l.unitPaisa) })),
      );
      if (overruns.length)
        throw new InvariantError(
          'BUDGET_EXCEEDED',
          'The order exceeds what the budget has left; the requisition needs an overrun approval',
          { overruns },
          true,
        );
    }
    const id = await this.d.procRepo.insertPo(
      {
        orgId: this.d.ctx.orgId,
        campusId: r.campusId,
        poNo: await this.d.numbers.next({ campusId: r.campusId, key: 'purchase_order', date: this.d.clock.now() }),
        vendorId: selected.vendorId,
        requisitionId: r.id,
        quotationId: selected.id,
        costCentreId: r.costCentreId,
        orderDate,
        expectedOn: i.expectedOn ?? null,
        totalPaisa: total,
        status: 'issued',
        terms: i.terms ?? null,
        issuedBy: this.d.ctx.userId,
      },
      i.lines.map((l, n) => ({
        lineNo: n + 1,
        description: l.description,
        quantity: l.quantity,
        unitPaisa: l.unitPaisa,
        accountId: l.accountId,
        itemVariantId: l.itemVariantId ?? null,
      })),
    );
    await this.d.procRepo.setRequisition(r.id, { status: 'ordered' });
    return (await this.d.procRepo.po(id))!;
  }
}

export class CancelPurchaseOrder extends UseCase<{ id: string; reason: string }, PoRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; reason: string }) {
    const po = await this.d.procRepo.po(i.id, true);
    if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.approve', { campusId: po.campusId });
    if (po.status !== 'issued' || po.lines!.some((l) => l.receivedQty > 0))
      throw new InvariantError('PO_NOT_CANCELLABLE', 'Only an issued order with nothing received can be cancelled');
    await this.d.procRepo.setPo(po.id, { status: 'cancelled', cancelledReason: i.reason });
    if (po.requisitionId) await this.d.procRepo.setRequisition(po.requisitionId, { status: 'approved' });
    return (await this.d.procRepo.po(po.id))!;
  }
}

/** Goods receipt note: quantities received per line (never more than ordered), on-time flag and a rating. */
export class ReceiveGoods extends UseCase<
  {
    poId: string;
    receivedOn?: string;
    storeId?: string;
    lines: Array<{ poLineId: string; quantity: number }>;
    rating?: number;
    note?: string;
  },
  ReceiptRow & { poStatus: PoRow['status'] }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    poId: string;
    receivedOn?: string;
    storeId?: string;
    lines: Array<{ poLineId: string; quantity: number }>;
    rating?: number;
    note?: string;
  }) {
    const po = await this.d.procRepo.po(i.poId, true);
    if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.create', { campusId: po.campusId });
    if (po.status !== 'issued' && po.status !== 'partially_received')
      throw new InvariantError('PO_NOT_OPEN', `The order is ${po.status}`);
    const receivedOn = i.receivedOn ?? today(this.d);
    if (receivedOn < po.orderDate)
      throw new InvariantError('DATE_INVALID', 'Goods cannot arrive before the order date');
    const result = applyReceipt(po.lines!, i.lines);
    const byLine = new Map(po.lines!.map((l) => [l.id, l]));
    const stockLines = i.lines.filter((l) => byLine.get(l.poLineId)?.itemVariantId);
    if (stockLines.length) {
      if (!i.storeId) throw new InvariantError('STORE_REQUIRED', 'Stock items are received into a store: give storeId');
      const store = await this.d.invApi.store(i.storeId);
      if (!store || store.campusId !== po.campusId || !store.isActive)
        throw new InvariantError('STORE_INVALID', 'The store must be an open store of the order campus');
    }
    const id = await this.d.procRepo.insertReceipt(
      {
        orgId: this.d.ctx.orgId,
        campusId: po.campusId,
        grnNo: await this.d.numbers.next({ campusId: po.campusId, key: 'grn', date: this.d.clock.now() }),
        purchaseOrderId: po.id,
        receivedOn,
        receivedBy: this.d.ctx.userId,
        onTime: !po.expectedOn || receivedOn <= po.expectedOn,
        rating: i.rating ?? null,
        note: i.note ?? null,
        storeId: stockLines.length ? i.storeId : null,
      },
      i.lines,
    );
    if (stockLines.length)
      await this.d.invApi.receivePurchase({
        storeId: i.storeId!,
        refType: 'goods_receipt',
        refId: id,
        reason: `${po.poNo} (${po.vendorName})`,
        lines: stockLines.map((l) => {
          const pl = byLine.get(l.poLineId)!;
          return { variantId: pl.itemVariantId!, qty: l.quantity, unitCostPaisa: pl.unitPaisa };
        }),
      });
    for (const [lineId, qty] of result.receivedQty)
      await this.d.procRepo.setPoLineQuantities(lineId, { receivedQty: qty });
    await this.d.procRepo.setPo(po.id, { status: result.status });
    const receipt = (await this.d.procRepo.receipts(po.id)).find((r) => r.id === id)!;
    return { ...receipt, poStatus: result.status };
  }
}

/**
 * Supplier bill matched to received goods (three-way match), VAT and TDS withheld at the vendor's rates, posted:
 * Dr expense (per PO line account, cost centre), Cr accounts payable (net), Cr VAT / TDS payable.
 */
export class RecordSupplierBill extends UseCase<
  {
    poId: string;
    billNo: string;
    billDate?: string;
    lines?: Array<{ poLineId: string; quantity: number }>;
    vatPaisa?: number;
    tdsPaisa?: number;
  },
  BillRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    poId: string;
    billNo: string;
    billDate?: string;
    lines?: Array<{ poLineId: string; quantity: number }>;
    vatPaisa?: number;
    tdsPaisa?: number;
  }) {
    const po = await this.d.procRepo.po(i.poId, true);
    if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.create', { campusId: po.campusId });
    if (po.status === 'cancelled' || po.status === 'issued')
      throw new InvariantError('NOTHING_RECEIVED', 'Bills are recorded against received goods');
    const lines = po.lines!;
    const wanted =
      i.lines ??
      lines
        .map((l) => ({ poLineId: l.id, quantity: Math.round((l.receivedQty - l.billedQty) * 1000) / 1000 }))
        .filter((l) => l.quantity > 0);
    if (!wanted.length) throw new InvariantError('NOTHING_TO_BILL', 'Everything received is already billed');
    const match = matchBill(lines, wanted);
    const v = (await this.d.procRepo.vendor(po.vendorId))!;
    const rates = withholding(match.grossPaisa, v.vatRatePct, v.tdsRatePct);
    const vatPaisa = i.vatPaisa ?? rates.vatPaisa;
    const tdsPaisa = i.tdsPaisa ?? rates.tdsPaisa;
    if (vatPaisa + tdsPaisa > match.grossPaisa)
      throw new InvariantError('WITHHOLDING_TOO_HIGH', 'VAT and TDS withheld exceed the bill amount');
    const netPayablePaisa = match.grossPaisa - vatPaisa - tdsPaisa;
    const billDate = i.billDate ?? today(this.d);

    const id = await this.d.procRepo.insertBill(
      {
        orgId: this.d.ctx.orgId,
        campusId: po.campusId,
        vendorId: po.vendorId,
        purchaseOrderId: po.id,
        billNo: i.billNo,
        billDate,
        dueDate: LocalDate.parse(billDate).addDays(v.paymentTermsDays).iso,
        grossPaisa: match.grossPaisa,
        vatPaisa,
        tdsPaisa,
        netPayablePaisa,
      },
      match.lines,
    );
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const l of match.lines) {
      const line = byId.get(l.poLineId)!;
      await this.d.procRepo.setPoLineQuantities(l.poLineId, {
        billedQty: Math.round((line.billedQty + l.quantity) * 1000) / 1000,
      });
      line.billedQty += l.quantity;
    }
    if (po.status === 'received' && lines.every((l) => l.billedQty >= l.quantity))
      await this.d.procRepo.setPo(po.id, { status: 'billed' });

    const map = await procurementAccounts(this.d, po.campusId);
    const accounts = await this.d.procRepo.accounts([...new Set(lines.map((l) => l.accountId!).filter(Boolean))]);
    const debit = new Map<string, number>();
    for (const l of match.lines) {
      const code = accounts.get(byId.get(l.poLineId)!.accountId!)?.code;
      if (!code) throw new InvariantError('ACCOUNT_REQUIRED', 'A PO line has no expense account');
      debit.set(code, (debit.get(code) ?? 0) + l.amountPaisa);
    }
    const memo = `${v.name} bill ${i.billNo}`;
    const party = { partyType: 'vendor' as const, partyId: v.id };
    const entry: EntryLine[] = [
      ...[...debit].map(([accountCode, amount]) => ({
        accountCode,
        debitPaisa: amount,
        creditPaisa: 0,
        memo,
        costCentreId: po.costCentreId,
      })),
      { accountCode: map.payable, debitPaisa: 0, creditPaisa: netPayablePaisa, memo, ...party },
    ];
    if (vatPaisa) entry.push({ accountCode: map.vat, debitPaisa: 0, creditPaisa: vatPaisa, memo, ...party });
    if (tdsPaisa) entry.push({ accountCode: map.tds, debitPaisa: 0, creditPaisa: tdsPaisa, memo, ...party });
    const j = await postJournal(this.d, {
      campusId: po.campusId,
      date: billDate,
      voucherType: 'journal',
      narration: `Supplier bill ${i.billNo} from ${v.name} (${po.poNo})`,
      source: { module: 'acc', type: 'supplier_bill', id },
      lines: entry.filter((l) => l.debitPaisa > 0 || l.creditPaisa > 0),
    });
    await this.d.procRepo.setBill(id, { journalId: j.id });
    return (await this.d.procRepo.bill(id))!;
  }
}

/** Pays (part of) a bill: Dr accounts payable, Cr bank / cash / mobile wallet. */
export class PaySupplierBill extends UseCase<
  { billId: string; amountPaisa?: number; paidOn?: string; method: 'bank' | 'cash' | 'mobile'; reference?: string },
  { bill: BillRow; payment: PaymentRow }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    billId: string;
    amountPaisa?: number;
    paidOn?: string;
    method: 'bank' | 'cash' | 'mobile';
    reference?: string;
  }) {
    const b = await this.d.procRepo.bill(i.billId, true);
    if (!b) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.procurement.approve', { campusId: b.campusId });
    if (b.status !== 'open' && b.status !== 'partially_paid')
      throw new InvariantError('BILL_CLOSED', `The bill is ${b.status}`);
    const due = b.netPayablePaisa - b.paidPaisa;
    const amount = i.amountPaisa ?? due;
    if (amount <= 0 || amount > due)
      throw new InvariantError('AMOUNT_INVALID', `Payment must be between 1 and ${due} paisa`);
    const paidOn = i.paidOn ?? today(this.d);
    if (paidOn < b.billDate) throw new InvariantError('DATE_INVALID', 'Payment cannot be before the bill date');
    const map = await procurementAccounts(this.d, b.campusId);
    const paymentNo = await this.d.numbers.next({
      campusId: b.campusId,
      key: 'supplier_payment',
      date: this.d.clock.now(),
    });
    const id = await this.d.procRepo.insertPayment({
      orgId: this.d.ctx.orgId,
      campusId: b.campusId,
      paymentNo,
      supplierBillId: b.id,
      vendorId: b.vendorId,
      paidOn,
      amountPaisa: amount,
      method: i.method,
      reference: i.reference ?? null,
    });
    const memo = `${paymentNo} ${b.vendorName} bill ${b.billNo}${i.reference ? ` (${i.reference})` : ''}`;
    const j = await postJournal(this.d, {
      campusId: b.campusId,
      date: paidOn,
      voucherType: 'payment',
      narration: `Payment to ${b.vendorName} for bill ${b.billNo}`,
      source: { module: 'acc', type: 'supplier_payment', id },
      lines: [
        {
          accountCode: map.payable,
          debitPaisa: amount,
          creditPaisa: 0,
          memo,
          partyType: 'vendor',
          partyId: b.vendorId,
        },
        { accountCode: map[i.method], debitPaisa: 0, creditPaisa: amount, memo },
      ],
    });
    const paid = b.paidPaisa + amount;
    await this.d.procRepo.setBill(b.id, {
      paidPaisa: paid,
      status: paid === b.netPayablePaisa ? 'paid' : 'partially_paid',
    });
    const payment = (await this.d.procRepo.payments(b.id)).find((p) => p.id === id)!;
    return { bill: (await this.d.procRepo.bill(b.id))!, payment: { ...payment, journalId: j.id } };
  }
}

/** The purchase order as a PDF to send to the supplier. */
export class RenderPurchaseOrder extends Query<{ id: string }, { filename: string; pdf: Buffer }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const po = await this.d.procRepo.po(id);
    if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
    this.d.scopePolicy.requireCampus(po.campusId);
    const vendor = (await this.d.procRepo.vendor(po.vendorId))!;
    const campus = await this.d.coreApi.getCampus(po.campusId);
    const schoolName =
      (await this.d.coreApi.getSetting<string>('org.display_name', po.campusId)) ?? campus?.nameEn ?? 'School';
    const requisition = po.requisitionId ? await this.d.procRepo.requisition(po.requisitionId) : null;
    const pdf = await this.d.poPdf.render({
      schoolName,
      campusName: campus?.nameEn ?? schoolName,
      poNo: po.poNo,
      status: po.status,
      orderDate: po.orderDate,
      expectedOn: po.expectedOn,
      requisitionNo: requisition?.prNo ?? null,
      terms: po.terms,
      issuedByName: null,
      totalPaisa: po.totalPaisa,
      vendor,
      lines: po.lines!.map((l) => ({ description: l.description, quantity: l.quantity, unitPaisa: l.unitPaisa })),
    });
    return { filename: `${po.poNo}.pdf`, pdf };
  }
}

export class ListPurchaseOrders extends Query<{ status?: string; vendorId?: string }, PoRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { status?: string; vendorId?: string }) {
    return this.d.procRepo.pos({ ...i, campusId: this.d.ctx.activeCampusId });
  }
}

export class GetPurchaseOrder extends Query<{ id: string }, PoRow & { receipts: ReceiptRow[]; bills: BillRow[] }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const po = await this.d.procRepo.po(id);
    if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
    this.d.scopePolicy.requireCampus(po.campusId);
    return {
      ...po,
      receipts: await this.d.procRepo.receipts(id),
      bills: await this.d.procRepo.bills({ purchaseOrderId: id }),
    };
  }
}

export class ListSupplierBills extends Query<{ vendorId?: string; status?: string }, BillRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { vendorId?: string; status?: string }) {
    return this.d.procRepo.bills({ ...i, campusId: this.d.ctx.activeCampusId });
  }
}

export class GetSupplierBill extends Query<{ id: string }, BillRow & { payments: PaymentRow[] }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const b = await this.d.procRepo.bill(id);
    if (!b) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    this.d.scopePolicy.requireCampus(b.campusId);
    return { ...b, payments: await this.d.procRepo.payments(id) };
  }
}

/** Accounts payable aging per vendor: not yet due, 1-30, 31-60, 61-90 and over 90 days overdue. */
export class PayablesAging extends Query<
  { asOf?: string },
  {
    asOf: string;
    vendors: Array<{
      vendorId: string;
      vendorName: string;
      currentPaisa: number;
      d1to30Paisa: number;
      d31to60Paisa: number;
      d61to90Paisa: number;
      over90Paisa: number;
      totalPaisa: number;
    }>;
    totalPaisa: number;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { asOf?: string }) {
    const asOf = i.asOf ?? today(this.d);
    const at = LocalDate.parse(asOf);
    const rows = new Map<string, ReturnType<PayablesAging['emptyRow']>>();
    for (const b of await this.d.procRepo.bills({ campusId: this.d.ctx.activeCampusId, open: true })) {
      if (b.billDate > asOf) continue;
      const open = b.netPayablePaisa - b.paidPaisa;
      let row = rows.get(b.vendorId);
      if (!row) rows.set(b.vendorId, (row = this.emptyRow(b.vendorId, b.vendorName)));
      const late = LocalDate.parse(b.dueDate).daysUntil(at);
      if (late <= 0) row.currentPaisa += open;
      else if (late <= 30) row.d1to30Paisa += open;
      else if (late <= 60) row.d31to60Paisa += open;
      else if (late <= 90) row.d61to90Paisa += open;
      else row.over90Paisa += open;
      row.totalPaisa += open;
    }
    const vendors = [...rows.values()].sort((a, b) => b.totalPaisa - a.totalPaisa);
    return { asOf, vendors, totalPaisa: vendors.reduce((s, v) => s + v.totalPaisa, 0) };
  }

  private emptyRow(vendorId: string, vendorName: string) {
    return {
      vendorId,
      vendorName,
      currentPaisa: 0,
      d1to30Paisa: 0,
      d31to60Paisa: 0,
      d61to90Paisa: 0,
      over90Paisa: 0,
      totalPaisa: 0,
    };
  }
}
