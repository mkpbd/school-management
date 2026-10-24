import type { EventPublisher, FieldCipher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AttModuleApi } from '../../att/public-api/AttModuleApi.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import { computePayslip, periodOf, type PayrollInput } from '../domain/payroll.js';
import { monthsAfter, validateRules, type TaxCategory, type TaxRules } from '../domain/tax.js';
import type {
  ContractView,
  LoanView,
  PayrollRepository,
  PayrollRunRow,
  PayslipDetail,
  PayslipSummary,
  RunStatus,
  TaxProfileRow,
  TaxYearRow,
} from './payrollPorts.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  payrollRepo: PayrollRepository;
  scopePolicy: ScopePolicy;
  outbox: EventPublisher;
  fieldCipher: FieldCipher;
  coreApi: CoreModuleApi;
  attApi: AttModuleApi;
  payslipPdf: PayslipPdfRenderer;
}

export interface PayslipPdfHeader {
  schoolName: string;
  campusName: string;
  generatedAt: Date;
}

/** Port: payslip pages as one PDF (infrastructure: pdfkit). */
export interface PayslipPdfRenderer {
  render(header: PayslipPdfHeader, slips: PayslipDetail[]): Promise<Buffer>;
}

export interface BankAccount {
  bankName: string;
  branchName: string;
  routingNo: string;
  accountName: string;
  accountNo: string;
}

const monthOf = (periodMonth: string) => periodMonth.slice(0, 7);

async function visibleRun(d: Deps, id: string, forUpdate = true): Promise<PayrollRunRow> {
  const r = await d.payrollRepo.run(id, forUpdate);
  if (!r) throw new NotFoundError('Payroll run not found');
  d.scopePolicy.requireCampus(r.campusId);
  return r;
}

function expectStatus(run: PayrollRunRow, allowed: RunStatus[], action: string): void {
  if (!allowed.includes(run.status))
    throw new ConflictError('PAYROLL_STATUS', `Cannot ${action} a payroll that is ${run.status}`);
}

async function occasionalCodes(d: Deps, campusId: string): Promise<string[]> {
  return (await d.coreApi.getSetting<string[]>('hrm.occasional_components', campusId)) ?? ['FEST_BONUS'];
}

// ---------------------------------------------------------------------------------------------------------------
// Contracts, bank account, loans
// ---------------------------------------------------------------------------------------------------------------

export interface ContractInput {
  staffId: string;
  contractType: 'permanent' | 'fixed_term' | 'part_time' | 'hourly' | 'probation';
  startsOn: string;
  endsOn?: string;
  probationEndsOn?: string;
  basicPaisa: number;
  components: Array<{ componentCode: string; amountPaisa?: number; percent?: number }>;
}

async function resolveComponents(d: Deps, list: ContractInput['components']) {
  const all = new Map((await d.payrollRepo.components()).map((c) => [c.code, c]));
  return list.map((c) => {
    const comp = all.get(c.componentCode);
    if (!comp) throw new InvariantError('COMPONENT_UNKNOWN', `Unknown salary component ${c.componentCode}`);
    if (comp.code === 'BASIC') throw new InvariantError('BASIC_IN_COMPONENTS', 'Basic pay is set on the contract');
    const wantsPercent = comp.calc === 'percent_of_basic';
    if (wantsPercent ? c.percent === undefined : c.amountPaisa === undefined)
      throw new InvariantError(
        'COMPONENT_VALUE',
        `${comp.code} needs ${wantsPercent ? 'percent' : 'amountPaisa'} (${comp.calc})`,
      );
    return {
      componentId: comp.id,
      amountPaisa: wantsPercent ? null : (c.amountPaisa ?? 0),
      percent: wantsPercent ? (c.percent ?? 0) : null,
    };
  });
}

/** Employment contract with basic pay and allowances / deductions; contracts of a staff member never overlap. */
export class CreateContract extends UseCase<ContractInput, ContractView> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: ContractInput) {
    const s = await this.d.payrollRepo.staffOf(i.staffId);
    if (!s) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
    this.d.scopePolicy.requireCampus(s.campusId);
    if (i.endsOn && i.endsOn < i.startsOn)
      throw new InvariantError('DATE_RANGE_INVALID', 'Contract ends before it starts');
    const rows = await resolveComponents(this.d, i.components);
    const id = await this.d.payrollRepo.insertContract({
      orgId: this.d.ctx.orgId,
      staffId: i.staffId,
      contractType: i.contractType,
      startsOn: i.startsOn,
      endsOn: i.endsOn ?? null,
      probationEndsOn: i.probationEndsOn ?? null,
      basicPaisa: i.basicPaisa,
    });
    await this.d.payrollRepo.replaceContractComponents(id, rows);
    return (await this.d.payrollRepo.contract(id))!;
  }
}

/** Salary revision: a new contract from a date ends the current one the day before (no overlap). */
export class ReviseContract extends UseCase<
  { contractId: string; effectiveFrom: string; basicPaisa: number; components: ContractInput['components'] },
  ContractView
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    contractId: string;
    effectiveFrom: string;
    basicPaisa: number;
    components: ContractInput['components'];
  }) {
    const old = await this.d.payrollRepo.contract(i.contractId);
    if (!old) throw new NotFoundError();
    const s = (await this.d.payrollRepo.staffOf(old.staffId))!;
    this.d.scopePolicy.requireCampus(s.campusId);
    if (i.effectiveFrom <= old.startsOn || (old.endsOn && i.effectiveFrom > old.endsOn))
      throw new InvariantError('REVISION_DATE', 'The revision date must fall inside the current contract');
    await this.d.payrollRepo.endContract(old.id, LocalDate.parse(i.effectiveFrom).addDays(-1).iso);
    const rows = await resolveComponents(this.d, i.components);
    const id = await this.d.payrollRepo.insertContract({
      orgId: this.d.ctx.orgId,
      staffId: old.staffId,
      contractType: old.contractType,
      startsOn: i.effectiveFrom,
      endsOn: old.endsOn,
      basicPaisa: i.basicPaisa,
    });
    await this.d.payrollRepo.replaceContractComponents(id, rows);
    return (await this.d.payrollRepo.contract(id))!;
  }
}

export class ListContracts extends Query<{ staffId: string }, ContractView[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ staffId }: { staffId: string }) {
    if (!(await this.d.payrollRepo.staffOf(staffId))) throw new NotFoundError();
    return this.d.payrollRepo.contractsOfStaff(staffId);
  }
}

/** Salary account for the bank advice; stored encrypted, only the last 4 digits are ever returned. */
export class SetBankAccount extends UseCase<
  { staffId: string; account: BankAccount | null },
  { staffId: string; accountNoLast4: string | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { staffId: string; account: BankAccount | null }) {
    const s = await this.d.payrollRepo.staffOf(i.staffId);
    if (!s) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(s.campusId);
    const enc = i.account ? this.d.fieldCipher.encrypt(JSON.stringify(i.account)) : null;
    await this.d.payrollRepo.setBankAccount(i.staffId, enc);
    return { staffId: i.staffId, accountNoLast4: i.account ? i.account.accountNo.slice(-4) : null };
  }
}

export class GrantLoan extends UseCase<
  {
    staffId: string;
    kind: 'loan' | 'advance';
    principalPaisa: number;
    installmentPaisa: number;
    startsMonth: string;
    reason?: string;
  },
  { id: string; installments: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    staffId: string;
    kind: 'loan' | 'advance';
    principalPaisa: number;
    installmentPaisa: number;
    startsMonth: string;
    reason?: string;
  }) {
    const s = await this.d.payrollRepo.staffOf(i.staffId);
    if (!s) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
    this.d.scopePolicy.requireCampus(s.campusId);
    if (i.installmentPaisa > i.principalPaisa)
      throw new InvariantError('INSTALLMENT_TOO_HIGH', 'Installment is larger than the principal');
    const id = await this.d.payrollRepo.insertLoan({
      orgId: this.d.ctx.orgId,
      staffId: i.staffId,
      kind: i.kind,
      principalPaisa: i.principalPaisa,
      installmentPaisa: i.installmentPaisa,
      outstandingPaisa: i.principalPaisa,
      startsMonth: periodOf(i.startsMonth).start,
      reason: i.reason ?? null,
    });
    return { id, installments: Math.ceil(i.principalPaisa / i.installmentPaisa) };
  }
}

export class ListLoans extends Query<{ staffId?: string; status?: string }, LoanView[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { staffId?: string; status?: string }) {
    return this.d.payrollRepo.loans(i);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Payroll run: draft -> computed -> submitted -> approved -> locked -> paid  (HRM-04)
// ---------------------------------------------------------------------------------------------------------------

export class CreatePayrollRun extends UseCase<
  { campusId?: string; month: string; includeComponents?: string[] },
  PayrollRunRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; month: string; includeComponents?: string[] }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const period = periodOf(i.month);
    const occasional = await occasionalCodes(this.d, campusId);
    const bad = (i.includeComponents ?? []).filter((c) => !occasional.includes(c));
    if (bad.length)
      throw new InvariantError(
        'NOT_OCCASIONAL',
        `Only occasional components can be included: ${occasional.join(', ')}`,
      );
    const id = await this.d.payrollRepo.insertRun({
      orgId: this.d.ctx.orgId,
      campusId,
      periodMonth: period.start,
      includedComponents: i.includeComponents ?? [],
    });
    return (await this.d.payrollRepo.run(id, false))!;
  }
}

export type InputRow = { staffId: string } & Partial<PayrollInput>;

/** Unpaid leave, overtime, cover periods and one-off adjustments; a computed run goes back to draft. */
export class SetPayrollInputs extends UseCase<
  { runId: string; rows: InputRow[] },
  { saved: number; status: RunStatus }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { runId: string; rows: InputRow[] }) {
    const run = await visibleRun(this.d, i.runId);
    expectStatus(run, ['draft', 'computed'], 'change inputs of');
    const existing = await this.d.payrollRepo.inputs(run.id);
    const rows = i.rows.map((r) => {
      const prev = existing.get(r.staffId);
      return {
        staffId: r.staffId,
        lwpDays: r.lwpDays ?? prev?.lwpDays ?? 0,
        overtimeMinutes: r.overtimeMinutes ?? prev?.overtimeMinutes ?? 0,
        coverPeriods: r.coverPeriods ?? prev?.coverPeriods ?? 0,
        adjustments: r.adjustments ?? prev?.adjustments ?? [],
      };
    });
    await this.d.payrollRepo.upsertInputs({ id: run.id, orgId: this.d.ctx.orgId, campusId: run.campusId }, rows);
    if (run.status === 'computed') await this.d.payrollRepo.updateRun(run.id, { status: 'draft' });
    return { saved: rows.length, status: 'draft' as const };
  }
}

/**
 * Fills unpaid days (LWP) and overtime of every payroll staff member from ATT: unpaid leave, absences, half days and
 * (optionally) N lates per day. Cover periods and adjustments already entered are kept; the run goes back to draft.
 */
export class PullAttendanceInputs extends UseCase<
  { runId: string },
  {
    status: RunStatus;
    rows: Array<{
      staffId: string;
      staffNo: string;
      lwpDays: number;
      overtimeMinutes: number;
      lwpBreakdown: { unpaidLeave: number; absent: number; halfDay: number; late: number };
    }>;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const { d } = this;
    const run = await visibleRun(d, runId);
    expectStatus(run, ['draft', 'computed'], 'change inputs of');
    const month = monthOf(run.periodMonth);
    const staff = await d.payrollRepo.payrollStaff(run.campusId, periodOf(month));
    const summaries = await d.attApi.staffMonthSummaries(
      run.campusId,
      staff.map((s) => s.staffId),
      month,
    );
    const existing = await d.payrollRepo.inputs(run.id);
    const rows = staff.map((s) => {
      const a = summaries.get(s.staffId);
      const prev = existing.get(s.staffId);
      return {
        staffId: s.staffId,
        staffNo: s.staffNo,
        lwpDays: a?.lwpDays ?? 0,
        overtimeMinutes: a?.overtimeMinutes ?? 0,
        coverPeriods: prev?.coverPeriods ?? 0,
        adjustments: prev?.adjustments ?? [],
        lwpBreakdown: a?.lwpBreakdown ?? { unpaidLeave: 0, absent: 0, halfDay: 0, late: 0 },
      };
    });
    await d.payrollRepo.upsertInputs(
      { id: run.id, orgId: d.ctx.orgId, campusId: run.campusId },
      rows.map(({ staffNo: _n, lwpBreakdown: _b, ...r }) => r),
    );
    if (run.status === 'computed') await d.payrollRepo.updateRun(run.id, { status: 'draft' });
    return {
      status: 'draft' as const,
      rows: rows.map(({ staffId, staffNo, lwpDays, overtimeMinutes, lwpBreakdown }) => ({
        staffId,
        staffNo,
        lwpDays,
        overtimeMinutes,
        lwpBreakdown,
      })),
    };
  }
}

export interface ComputeSummary {
  runId: string;
  staff: number;
  grossPaisa: number;
  deductionsPaisa: number;
  netPaisa: number;
  warnings: Array<{ staffId: string; staffNo: string; code: string; message: string }>;
  skipped: Array<{ staffId: string; staffNo: string; reason: string }>;
}

/** (Re)computes every payslip of the run from contracts, inputs and active loans. */
export class ComputePayroll extends UseCase<{ runId: string }, ComputeSummary> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const { d } = this;
    const run = await visibleRun(d, runId);
    expectStatus(run, ['draft', 'computed'], 'compute');
    const period = periodOf(monthOf(run.periodMonth));
    const staff = await d.payrollRepo.payrollStaff(run.campusId, period);
    const ids = staff.map((s) => s.staffId);
    const [components, contracts, inputs, loans, occasional] = [
      await d.payrollRepo.components(),
      await d.payrollRepo.contractTerms(ids, period),
      await d.payrollRepo.inputs(run.id),
      await d.payrollRepo.activeLoans(ids, period.start),
      await occasionalCodes(d, run.campusId),
    ];
    // automatic TDS when the income year has a tax table (and hrm.auto_tds is not switched off)
    const autoTds = (await d.coreApi.getSetting<boolean>('hrm.auto_tds', run.campusId)) ?? true;
    const taxYear = autoTds ? await d.payrollRepo.taxYearFor(period.start) : null;
    const profiles = taxYear ? await d.payrollRepo.taxProfiles(ids, taxYear.code) : new Map<string, TaxProfileRow>();
    const ytd = taxYear
      ? await d.payrollRepo.taxYtd(ids, taxYear.startsOn, period.start)
      : new Map<string, { taxable: number; tax: number }>();
    await d.payrollRepo.clearComputation(run.id);
    const summary: ComputeSummary = {
      runId: run.id,
      staff: 0,
      grossPaisa: 0,
      deductionsPaisa: 0,
      netPaisa: 0,
      warnings: [],
      skipped: [],
    };
    if (autoTds && !taxYear)
      summary.warnings.push({
        staffId: '',
        staffNo: '',
        code: 'NO_TAX_TABLE',
        message: 'No tax table covers this month; tax only from contracts',
      });
    if (taxYear && !taxYear.verifiedAt)
      summary.warnings.push({
        staffId: '',
        staffNo: '',
        code: 'TAX_TABLE_UNVERIFIED',
        message: `Tax table ${taxYear.code} is not verified against the Finance Act`,
      });
    const runRef = { id: run.id, orgId: d.ctx.orgId, campusId: run.campusId };
    for (const s of staff) {
      try {
        const r = computePayslip({
          period,
          staff: { joinedOn: s.joinedOn, leftOn: s.leftOn },
          contracts: contracts.get(s.staffId) ?? [],
          components,
          input: inputs.get(s.staffId) ?? { lwpDays: 0, overtimeMinutes: 0, coverPeriods: 0, adjustments: [] },
          loans: loans.get(s.staffId) ?? [],
          occasionalCodes: occasional,
          includedCodes: run.includedComponents,
          tds: taxYear
            ? {
                rules: taxYear.rules,
                category: profiles.get(s.staffId)?.category ?? 'general',
                investmentPaisa: profiles.get(s.staffId)?.declaredInvestmentPaisa ?? 0,
                disabledChildren: profiles.get(s.staffId)?.disabledChildren ?? 0,
                newTaxpayer: profiles.get(s.staffId)?.newTaxpayer ?? false,
                ytdTaxablePaisa: ytd.get(s.staffId)?.taxable ?? 0,
                ytdTaxPaisa: ytd.get(s.staffId)?.tax ?? 0,
                monthsAfterThis: monthsAfter(period.start, taxYear.endsOn),
              }
            : undefined,
        });
        await d.payrollRepo.insertPayslip(runRef, s.staffId, r);
        await d.payrollRepo.insertRecoveries(d.ctx.orgId, run.id, r.loanRecoveries, period.end);
        summary.staff++;
        summary.grossPaisa += r.grossPaisa;
        summary.deductionsPaisa += r.deductionsPaisa;
        summary.netPaisa += r.netPaisa;
        for (const w of r.warnings) summary.warnings.push({ staffId: s.staffId, staffNo: s.staffNo, ...w });
      } catch (err) {
        if (!(err instanceof InvariantError) || err.code === 'PAYROLL_SETUP' || err.code === 'COMPONENT_UNKNOWN')
          throw err;
        summary.skipped.push({ staffId: s.staffId, staffNo: s.staffNo, reason: err.message });
      }
    }
    await d.payrollRepo.updateRun(run.id, {
      status: 'computed',
      grossPaisa: summary.grossPaisa,
      deductionsPaisa: summary.deductionsPaisa,
      netPaisa: summary.netPaisa,
      computedAt: d.clock.now(),
    });
    return summary;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Income tax tables and staff tax profiles
// ---------------------------------------------------------------------------------------------------------------

export class ListTaxYears extends Query<Record<string, never>, TaxYearRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.payrollRepo.taxYears();
  }
}

/** Saves the rules of an income year; any change clears the verification. */
export class SaveTaxYear extends UseCase<
  { code: string; startsOn: string; endsOn: string; rules: TaxRules; sourceNote?: string },
  TaxYearRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { code: string; startsOn: string; endsOn: string; rules: TaxRules; sourceNote?: string }) {
    validateRules(i.rules);
    await this.d.payrollRepo.upsertTaxYear(this.d.ctx.orgId, { ...i, sourceNote: i.sourceNote ?? null });
    return (await this.d.payrollRepo.taxYears()).find((t) => t.code === i.code)!;
  }
}

export class VerifyTaxYear extends UseCase<{ code: string }, TaxYearRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ code }: { code: string }) {
    if (!(await this.d.payrollRepo.verifyTaxYear(code, this.d.ctx.userId!, this.d.clock.now())))
      throw new NotFoundError();
    return (await this.d.payrollRepo.taxYears()).find((t) => t.code === code)!;
  }
}

export class SetTaxProfile extends UseCase<
  {
    staffId: string;
    taxYearCode: string;
    category: TaxCategory;
    declaredInvestmentPaisa: number;
    disabledChildren?: number;
    newTaxpayer?: boolean;
  },
  TaxProfileRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    staffId: string;
    taxYearCode: string;
    category: TaxCategory;
    declaredInvestmentPaisa: number;
    disabledChildren?: number;
    newTaxpayer?: boolean;
  }) {
    const s = await this.d.payrollRepo.staffOf(i.staffId);
    if (!s) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(s.campusId);
    const row: TaxProfileRow = { ...i, disabledChildren: i.disabledChildren ?? 0, newTaxpayer: i.newTaxpayer ?? false };
    await this.d.payrollRepo.upsertTaxProfile(this.d.ctx.orgId, row);
    return row;
  }
}

export class SubmitPayroll extends UseCase<{ runId: string }, PayrollRunRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const run = await visibleRun(this.d, runId);
    expectStatus(run, ['computed'], 'submit');
    const t = await this.d.payrollRepo.totals(run.id);
    if (!t.count) throw new ConflictError('PAYROLL_EMPTY', 'No payslips to submit');
    if (t.negative) throw new ConflictError('NEGATIVE_NET', `${t.negative} payslip(s) have a negative net pay`);
    await this.d.payrollRepo.updateRun(run.id, {
      status: 'submitted',
      submittedBy: this.d.ctx.userId,
      submittedAt: this.d.clock.now(),
    });
    return (await this.d.payrollRepo.run(run.id, false))!;
  }
}

/** Maker-checker: the approver must not be the submitter (also enforced by a database CHECK). */
export class DecidePayroll extends UseCase<
  { runId: string; decision: 'approve' | 'reject'; note?: string },
  PayrollRunRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { runId: string; decision: 'approve' | 'reject'; note?: string }) {
    const run = await visibleRun(this.d, i.runId);
    expectStatus(run, ['submitted'], 'decide');
    if (run.submittedBy === this.d.ctx.userId)
      throw new ForbiddenError('MAKER_CHECKER', 'The submitter cannot approve or reject the same payroll');
    await this.d.payrollRepo.updateRun(
      run.id,
      i.decision === 'approve'
        ? {
            status: 'approved',
            approvedBy: this.d.ctx.userId,
            approvedAt: this.d.clock.now(),
            decisionNote: i.note ?? null,
          }
        : { status: 'computed', submittedBy: null, submittedAt: null, decisionNote: i.note ?? null },
    );
    return (await this.d.payrollRepo.run(run.id, false))!;
  }
}

/** Final: payslips frozen, loan installments taken, staff told their payslip is ready, accounts can post. */
export class LockPayroll extends UseCase<{ runId: string }, PayrollRunRow & { loansUpdated: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const { d } = this;
    const run = await visibleRun(d, runId);
    expectStatus(run, ['approved'], 'lock');
    const loansUpdated = await d.payrollRepo.applyRecoveries(run.id);
    await d.payrollRepo.updateRun(run.id, { status: 'locked', lockedAt: d.clock.now() });
    const sheet = await d.payrollRepo.sheet(run.id);
    const components = await d.payrollRepo.componentTotals(run.id);
    await d.outbox.write([
      {
        type: 'hrm.payroll_locked.v1',
        aggregateType: 'payroll_run',
        aggregateId: run.id,
        orgId: d.ctx.orgId,
        campusId: run.campusId,
        occurredAt: d.clock.now(),
        payload: {
          runId: run.id,
          month: monthOf(run.periodMonth),
          grossPaisa: run.grossPaisa,
          deductionsPaisa: run.deductionsPaisa,
          netPaisa: run.netPaisa,
          staffIds: sheet.map((s) => s.staffId),
          /** totals per salary component: the salary journal (ACC) */
          components,
        },
      },
    ]);
    return { ...(await d.payrollRepo.run(run.id, false))!, loansUpdated };
  }
}

export class MarkPayrollPaid extends UseCase<{ runId: string; paymentReference: string }, PayrollRunRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { runId: string; paymentReference: string }) {
    const run = await visibleRun(this.d, i.runId);
    expectStatus(run, ['locked'], 'mark as paid');
    await this.d.payrollRepo.updateRun(run.id, {
      status: 'paid',
      paidAt: this.d.clock.now(),
      paymentReference: i.paymentReference,
    });
    await this.d.outbox.write([
      {
        type: 'hrm.payroll_paid.v1',
        aggregateType: 'payroll_run',
        aggregateId: run.id,
        orgId: this.d.ctx.orgId,
        campusId: run.campusId,
        occurredAt: this.d.clock.now(),
        payload: {
          runId: run.id,
          month: monthOf(run.periodMonth),
          netPaisa: run.netPaisa,
          paymentReference: i.paymentReference,
          paidOn: LocalDate.today(this.d.clock).iso,
        },
      },
    ]);
    return (await this.d.payrollRepo.run(run.id, false))!;
  }
}

export class CancelPayrollRun extends UseCase<{ runId: string }, PayrollRunRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const run = await visibleRun(this.d, runId);
    expectStatus(run, ['draft', 'computed', 'submitted'], 'cancel');
    await this.d.payrollRepo.clearComputation(run.id);
    await this.d.payrollRepo.updateRun(run.id, { status: 'cancelled' });
    return (await this.d.payrollRepo.run(run.id, false))!;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------

export class ListPayrollRuns extends Query<{ campusId?: string; year?: number }, PayrollRunRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { campusId?: string; year?: number }) {
    return this.d.payrollRepo.runs(i);
  }
}

export class GetPayrollSheet extends Query<
  { runId: string },
  PayrollRunRow & {
    payslips: PayslipSummary[];
    totals: { staff: number; grossPaisa: number; deductionsPaisa: number; netPaisa: number };
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const run = await visibleRun(this.d, runId, false);
    const payslips = await this.d.payrollRepo.sheet(run.id);
    const t = await this.d.payrollRepo.totals(run.id);
    return {
      ...run,
      payslips,
      totals: { staff: t.count, grossPaisa: t.gross, deductionsPaisa: t.deductions, netPaisa: t.net },
    };
  }
}

/** Payroll staff see any payslip of their campuses; a staff member sees their own once the payroll is locked. */
export class GetPayslip extends Query<{ id: string }, PayslipDetail> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const p = await this.d.payrollRepo.payslip(id);
    if (!p) throw new NotFoundError();
    const own = !!this.d.ctx.staffId && p.staffId === this.d.ctx.staffId && ['locked', 'paid'].includes(p.runStatus);
    if (!own && !this.d.scopePolicy.has('hrm.payroll.view')) throw new NotFoundError();
    return p;
  }
}

export class MyPayslips extends Query<Record<string, never>, Array<PayslipSummary & { periodMonth: string }>> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle() {
    if (!this.d.ctx.staffId) throw new NotFoundError('No staff record for this login', 'NOT_STAFF');
    return this.d.payrollRepo.payslipsOfStaff(this.d.ctx.staffId);
  }
}

async function pdfHeader(d: Deps, campusId: string): Promise<PayslipPdfHeader> {
  const campus = await d.coreApi.getCampus(campusId);
  const school = (await d.coreApi.getSetting<string>('org.display_name', campusId)) ?? campus?.nameEn ?? 'School';
  return { schoolName: school, campusName: campus?.nameEn ?? school, generatedAt: d.clock.now() };
}

/** One payslip as PDF: same access as GetPayslip (payroll staff, or the staff member once locked). */
export class RenderPayslipPdf extends Query<{ id: string }, { filename: string; pdf: Buffer }> {
  constructor(private readonly d: Deps & { getPayslip: GetPayslip }) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const p = await this.d.getPayslip.execute({ id });
    const pdf = await this.d.payslipPdf.render(await pdfHeader(this.d, p.campusId), [p]);
    return { filename: `payslip-${p.staffNo}-${monthOf(p.periodMonth)}.pdf`, pdf };
  }
}

/** Every payslip of a run, one per page (for printing / distribution). */
export class RenderRunPayslipsPdf extends Query<{ runId: string }, { filename: string; pdf: Buffer }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const run = await visibleRun(this.d, runId, false);
    const slips: PayslipDetail[] = [];
    for (const s of await this.d.payrollRepo.sheet(run.id)) slips.push((await this.d.payrollRepo.payslip(s.id))!);
    const pdf = await this.d.payslipPdf.render(await pdfHeader(this.d, run.campusId), slips);
    return { filename: `payslips-${monthOf(run.periodMonth)}.pdf`, pdf };
  }
}

/** Bank transfer list (CSV) of a locked / paid payroll; staff without a salary account are listed as CASH. */
export class BankAdvice extends Query<{ runId: string }, { filename: string; csv: string; missingAccounts: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ runId }: { runId: string }) {
    const run = await visibleRun(this.d, runId, false);
    expectStatus(run, ['locked', 'paid'], 'export the bank advice of');
    const rows = await this.d.payrollRepo.bankAdvice(run.id);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ['staff_no,name,bank,branch,routing_no,account_name,account_no,amount_bdt'];
    let missing = 0;
    for (const r of rows) {
      const acc = r.bankAccountEnc ? (JSON.parse(this.d.fieldCipher.decrypt(r.bankAccountEnc)) as BankAccount) : null;
      if (!acc) missing++;
      lines.push(
        [
          r.staffNo,
          r.name,
          acc?.bankName ?? 'CASH',
          acc?.branchName ?? '',
          acc?.routingNo ?? '',
          acc?.accountName ?? '',
          acc?.accountNo ?? '',
          (r.netPaisa / 100).toFixed(2),
        ]
          .map(esc)
          .join(','),
      );
    }
    return {
      filename: `bank-advice-${monthOf(run.periodMonth)}.csv`,
      csv: `${lines.join('\n')}\n`,
      missingAccounts: missing,
    };
  }
}
