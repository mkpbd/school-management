import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import { available, budgetKey, monthsElapsed, spreadAnnual, type BudgetPosition } from '../domain/procurement.js';
import type { BudgetLineRow, BudgetRow, CostCentreRow, ProcurementRepository } from './procurementPorts.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  procRepo: ProcurementRepository;
  scopePolicy: ScopePolicy;
  coreApi: CoreModuleApi;
  outbox: EventPublisher;
}

export interface BudgetLineInput {
  accountId: string;
  costCentreId?: string | null;
  /** spread evenly over the 12 months */
  annualPaisa?: number;
  /** or month by month (January = index 0) */
  months?: number[];
}

/** Turns line inputs into month rows; accounts must be postable income / expense accounts, cost centres active. */
async function toMonthRows(d: Deps, lines: BudgetLineInput[]): Promise<BudgetLineRow[]> {
  const accounts = await d.procRepo.accounts([...new Set(lines.map((l) => l.accountId))]);
  const centres = new Map((await d.procRepo.costCentres()).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const rows: BudgetLineRow[] = [];
  for (const l of lines) {
    const a = accounts.get(l.accountId);
    if (!a || !a.isPostable || !a.isActive)
      throw new InvariantError('ACCOUNT_NOT_POSTABLE', 'Budget lines need active postable accounts');
    if (a.kind !== 'expense' && a.kind !== 'income')
      throw new InvariantError('ACCOUNT_KIND', `Account ${a.code} is not an income or expense account`);
    if (l.costCentreId && !centres.get(l.costCentreId)?.isActive)
      throw new InvariantError('COST_CENTRE_UNKNOWN', 'Unknown or inactive cost centre');
    const key = budgetKey(l.accountId, l.costCentreId ?? null);
    if (seen.has(key)) throw new InvariantError('DUPLICATE_LINE', `Account ${a.code} appears twice for a cost centre`);
    seen.add(key);
    if ((l.annualPaisa === undefined) === (l.months === undefined))
      throw new InvariantError('BUDGET_LINE_INVALID', 'Give either annualPaisa or months (12 values)');
    const months = l.months ?? spreadAnnual(l.annualPaisa!);
    if (months.length !== 12) throw new InvariantError('BUDGET_LINE_INVALID', 'months needs 12 values');
    months.forEach((amount, i) => {
      if (amount > 0)
        rows.push({
          accountId: l.accountId,
          costCentreId: l.costCentreId ?? null,
          monthNo: i + 1,
          amountPaisa: amount,
        });
    });
  }
  return rows;
}

/**
 * Budget position per account x cost centre for the academic year containing `date`: approved annual budget,
 * posted actuals to date and open purchase-order commitments.
 */
export async function budgetPositions(
  d: Pick<Deps, 'procRepo' | 'coreApi'>,
  campusId: string,
  date: string,
): Promise<{ budget: BudgetRow | null; positions: Map<string, BudgetPosition> }> {
  const positions = new Map<string, BudgetPosition>();
  const year = await d.coreApi.yearFor(date);
  if (!year) return { budget: null, positions };
  const approved = await d.procRepo.approvedBudget(campusId, year.id);
  const get = (k: string) => {
    let p = positions.get(k);
    if (!p) positions.set(k, (p = { budgetPaisa: 0, actualPaisa: 0, committedPaisa: 0 }));
    return p;
  };
  if (approved)
    for (const l of await d.procRepo.budgetLines(approved.id))
      get(budgetKey(l.accountId, l.costCentreId)).budgetPaisa += l.amountPaisa;
  const accounts = await d.procRepo.accounts([...new Set([...positions.keys()].map((k) => k.split('|')[0]!))]);
  for (const a of await d.procRepo.actuals({ campusId, from: year.startsOn, to: year.endsOn })) {
    const k = budgetKey(a.accountId, a.costCentreId);
    if (!positions.has(k)) continue;
    const kind = accounts.get(a.accountId)?.kind;
    positions.get(k)!.actualPaisa += kind === 'income' ? a.creditPaisa - a.debitPaisa : a.debitPaisa - a.creditPaisa;
  }
  for (const c of await d.procRepo.commitments({ campusId, from: year.startsOn, to: year.endsOn }))
    get(budgetKey(c.accountId, c.costCentreId)).committedPaisa += c.paisa;
  return { budget: approved, positions };
}

export class CreateBudget extends UseCase<
  {
    campusId?: string;
    academicYearId: string;
    name: string;
    lines?: BudgetLineInput[];
    revisionOfId?: string;
  },
  BudgetRow & { lines: BudgetLineRow[] }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    campusId?: string;
    academicYearId: string;
    name: string;
    lines?: BudgetLineInput[];
    revisionOfId?: string;
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    if (!(await this.d.coreApi.getYear(i.academicYearId)))
      throw new NotFoundError('Academic year not found', 'YEAR_NOT_FOUND');
    let rows: BudgetLineRow[] = [];
    if (i.revisionOfId) {
      const base = await this.d.procRepo.budget(i.revisionOfId);
      if (!base || base.campusId !== campusId || base.academicYearId !== i.academicYearId)
        throw new NotFoundError('Budget to revise not found', 'BUDGET_NOT_FOUND');
      if (base.status !== 'approved')
        throw new InvariantError('BUDGET_NOT_APPROVED', 'Only the approved budget can be revised');
      rows = await this.d.procRepo.budgetLines(base.id);
    }
    if (i.lines) rows = await toMonthRows(this.d, i.lines);
    const id = await this.d.procRepo.insertBudget({
      orgId: this.d.ctx.orgId,
      campusId,
      academicYearId: i.academicYearId,
      name: i.name,
      revisionOfId: i.revisionOfId ?? null,
    });
    await this.d.procRepo.replaceBudgetLines(id, rows);
    return { ...(await this.d.procRepo.budget(id))!, lines: rows };
  }
}

export class SetBudgetLines extends UseCase<{ id: string; lines: BudgetLineInput[] }, { lines: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { id: string; lines: BudgetLineInput[] }) {
    const b = await this.d.procRepo.budget(i.id, true);
    if (!b) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
    this.d.scopePolicy.requireCampus(b.campusId);
    if (b.status !== 'draft' && b.status !== 'rejected')
      throw new InvariantError('BUDGET_NOT_EDITABLE', `A ${b.status} budget cannot be changed; create a revision`);
    const rows = await toMonthRows(this.d, i.lines);
    await this.d.procRepo.replaceBudgetLines(b.id, rows);
    if (b.status === 'rejected') await this.d.procRepo.setBudget(b.id, { status: 'draft' });
    return { lines: rows.length };
  }
}

export class SubmitBudget extends UseCase<{ id: string }, BudgetRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ id }: { id: string }) {
    const b = await this.d.procRepo.budget(id, true);
    if (!b) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
    this.d.scopePolicy.requireCampus(b.campusId);
    if (b.status !== 'draft') throw new InvariantError('BUDGET_NOT_DRAFT', `The budget is ${b.status}`);
    if (!(await this.d.procRepo.budgetLines(id)).length)
      throw new InvariantError('BUDGET_EMPTY', 'Add budget lines before submitting');
    await this.d.procRepo.setBudget(id, {
      status: 'submitted',
      submittedBy: this.d.ctx.userId,
      submittedAt: this.d.clock.now(),
    });
    return (await this.d.procRepo.budget(id))!;
  }
}

/** Approve (a revision supersedes the approved budget) or reject; never by the person who submitted it. */
export class DecideBudget extends UseCase<{ id: string; decision: 'approved' | 'rejected'; note?: string }, BudgetRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { id: string; decision: 'approved' | 'rejected'; note?: string }) {
    const b = await this.d.procRepo.budget(i.id, true);
    if (!b) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
    await this.d.scopePolicy.assert('acc.budget.approve', { campusId: b.campusId });
    if (b.status !== 'submitted') throw new InvariantError('BUDGET_NOT_SUBMITTED', `The budget is ${b.status}`);
    if (b.submittedBy === this.d.ctx.userId)
      throw new InvariantError('SELF_APPROVAL', 'A budget must be approved by someone other than the submitter');
    if (i.decision === 'approved') {
      const current = await this.d.procRepo.approvedBudget(b.campusId, b.academicYearId);
      if (current && current.id !== b.revisionOfId)
        throw new ConflictError('BUDGET_EXISTS', 'An approved budget exists for this year; submit a revision of it');
      if (current) await this.d.procRepo.setBudget(current.id, { status: 'superseded' });
    }
    await this.d.procRepo.setBudget(b.id, {
      status: i.decision,
      decidedBy: this.d.ctx.userId,
      decidedAt: this.d.clock.now(),
      decisionNote: i.note ?? null,
    });
    if (b.submittedBy)
      await this.d.outbox.write([
        {
          type: 'acc.budget_decided.v1',
          aggregateType: 'budget',
          aggregateId: b.id,
          orgId: this.d.ctx.orgId,
          campusId: b.campusId,
          occurredAt: this.d.clock.now(),
          payload: {
            budgetId: b.id,
            name: b.name,
            submittedBy: b.submittedBy,
            decision: i.decision,
            note: i.note ?? null,
          },
        },
      ]);
    return (await this.d.procRepo.budget(b.id))!;
  }
}

export class ListBudgets extends Query<{ academicYearId?: string; status?: string }, BudgetRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { academicYearId?: string; status?: string }) {
    return this.d.procRepo.budgets({ ...i, campusId: this.d.ctx.activeCampusId });
  }
}

export interface BudgetLineView {
  accountId: string;
  accountCode: string;
  accountName: string;
  costCentreId: string | null;
  costCentreCode: string | null;
  months: number[];
  annualPaisa: number;
}

async function lineViews(d: Deps, rows: BudgetLineRow[]): Promise<BudgetLineView[]> {
  const accounts = await d.procRepo.accounts([...new Set(rows.map((r) => r.accountId))]);
  const centres = new Map((await d.procRepo.costCentres()).map((c) => [c.id, c]));
  const byKey = new Map<string, BudgetLineView>();
  for (const r of rows) {
    const k = budgetKey(r.accountId, r.costCentreId);
    let v = byKey.get(k);
    if (!v) {
      const a = accounts.get(r.accountId)!;
      v = {
        accountId: r.accountId,
        accountCode: a.code,
        accountName: a.nameEn,
        costCentreId: r.costCentreId,
        costCentreCode: r.costCentreId ? (centres.get(r.costCentreId)?.code ?? null) : null,
        months: Array.from({ length: 12 }, () => 0),
        annualPaisa: 0,
      };
      byKey.set(k, v);
    }
    v.months[r.monthNo - 1] = r.amountPaisa;
    v.annualPaisa += r.amountPaisa;
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.accountCode.localeCompare(b.accountCode) || (a.costCentreCode ?? '').localeCompare(b.costCentreCode ?? ''),
  );
}

export class GetBudget extends Query<{ id: string }, BudgetRow & { lines: BudgetLineView[]; totalPaisa: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const b = await this.d.procRepo.budget(id);
    if (!b) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
    this.d.scopePolicy.requireCampus(b.campusId);
    const lines = await lineViews(this.d, await this.d.procRepo.budgetLines(id));
    return { ...b, lines, totalPaisa: lines.reduce((s, l) => s + l.annualPaisa, 0) };
  }
}

export interface VarianceRow {
  accountCode: string;
  accountName: string;
  kind: 'income' | 'expense';
  costCentreCode: string | null;
  annualBudgetPaisa: number;
  budgetToDatePaisa: number;
  actualPaisa: number;
  committedPaisa: number;
  availablePaisa: number;
  /** favourable when positive: under budget for expenses, above budget for income */
  variancePaisa: number;
  usedPct: number | null;
  overBudget: boolean;
}

/** ACC-03 budget vs actual: year-to-date budget against posted actuals, with open commitments and what is left. */
export class BudgetVsActual extends Query<
  { budgetId: string; asOf?: string },
  { budget: BudgetRow; asOf: string; rows: VarianceRow[]; unbudgeted: VarianceRow[] }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { budgetId: string; asOf?: string }) {
    const b = await this.d.procRepo.budget(i.budgetId);
    if (!b) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
    this.d.scopePolicy.requireCampus(b.campusId);
    const year = await this.d.coreApi.getYear(b.academicYearId);
    if (!year) throw new NotFoundError('Academic year not found', 'YEAR_NOT_FOUND');
    const asOf = i.asOf ?? LocalDate.today(this.d.clock).iso;
    const to = asOf > year.endsOn ? year.endsOn : asOf;
    const elapsed = new Set(monthsElapsed(year.startsOn, year.endsOn, asOf));

    const lines = await this.d.procRepo.budgetLines(b.id);
    const actuals =
      asOf < year.startsOn ? [] : await this.d.procRepo.actuals({ campusId: b.campusId, from: year.startsOn, to });
    const commitments = await this.d.procRepo.commitments({
      campusId: b.campusId,
      from: year.startsOn,
      to: year.endsOn,
    });
    const accounts = await this.d.procRepo.accounts([
      ...new Set([...lines.map((l) => l.accountId), ...actuals.map((a) => a.accountId)]),
    ]);
    const centres = new Map((await this.d.procRepo.costCentres()).map((c): [string, CostCentreRow] => [c.id, c]));

    const acc = new Map<
      string,
      { accountId: string; costCentreId: string | null; budget: number; ytd: number; actual: number; committed: number }
    >();
    const get = (accountId: string, costCentreId: string | null) => {
      const k = budgetKey(accountId, costCentreId);
      let v = acc.get(k);
      if (!v) acc.set(k, (v = { accountId, costCentreId, budget: 0, ytd: 0, actual: 0, committed: 0 }));
      return v;
    };
    for (const l of lines) {
      const v = get(l.accountId, l.costCentreId);
      v.budget += l.amountPaisa;
      if (elapsed.has(l.monthNo)) v.ytd += l.amountPaisa;
    }
    const budgeted = new Set(acc.keys());
    for (const a of actuals) {
      const kind = accounts.get(a.accountId)?.kind;
      if (kind !== 'income' && kind !== 'expense') continue;
      get(a.accountId, a.costCentreId).actual +=
        kind === 'income' ? a.creditPaisa - a.debitPaisa : a.debitPaisa - a.creditPaisa;
    }
    for (const c of commitments)
      if (acc.has(budgetKey(c.accountId, c.costCentreId))) get(c.accountId, c.costCentreId).committed += c.paisa;

    const view = (v: typeof acc extends Map<string, infer V> ? V : never): VarianceRow => {
      const a = accounts.get(v.accountId)!;
      const kind = a.kind as 'income' | 'expense';
      const free = available({ budgetPaisa: v.budget, actualPaisa: v.actual, committedPaisa: v.committed });
      return {
        accountCode: a.code,
        accountName: a.nameEn,
        kind,
        costCentreCode: v.costCentreId ? (centres.get(v.costCentreId)?.code ?? null) : null,
        annualBudgetPaisa: v.budget,
        budgetToDatePaisa: v.ytd,
        actualPaisa: v.actual,
        committedPaisa: v.committed,
        availablePaisa: kind === 'expense' ? free : 0,
        variancePaisa: kind === 'expense' ? v.ytd - v.actual : v.actual - v.ytd,
        usedPct: v.budget ? Math.round(((v.actual + v.committed) / v.budget) * 10_000) / 100 : null,
        overBudget: kind === 'expense' && v.actual + v.committed > v.budget,
      };
    };
    const sort = (a: VarianceRow, b: VarianceRow) =>
      a.accountCode.localeCompare(b.accountCode) || (a.costCentreCode ?? '').localeCompare(b.costCentreCode ?? '');
    const all = [...acc.entries()];
    return {
      budget: b,
      asOf,
      rows: all
        .filter(([k]) => budgeted.has(k))
        .map(([, v]) => view(v))
        .sort(sort),
      unbudgeted: all
        .filter(([k, v]) => !budgeted.has(k) && v.actual !== 0)
        .map(([, v]) => view(v))
        .sort(sort),
    };
  }
}

export class ListCostCentres extends Query<Record<string, never>, CostCentreRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.procRepo.costCentres();
  }
}

export class CreateCostCentre extends UseCase<
  { code: string; nameEn: string; campusId?: string | null; departmentId?: string | null },
  CostCentreRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { code: string; nameEn: string; campusId?: string | null; departmentId?: string | null }) {
    if (i.campusId) this.d.scopePolicy.requireCampus(i.campusId);
    const id = await this.d.procRepo.insertCostCentre({
      orgId: this.d.ctx.orgId,
      code: i.code.toUpperCase(),
      nameEn: i.nameEn,
      campusId: i.campusId ?? null,
      departmentId: i.departmentId ?? null,
    });
    return (await this.d.procRepo.costCentre(id))!;
  }
}
