import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  contract,
  contractComponent,
  loanRecovery,
  payrollInput,
  payrollRun,
  payslip,
  payslipLine,
  salaryComponent,
  staff,
  staffLoan,
  staffTaxProfile,
  taxYear,
} from '../../../shared/infrastructure/db/schema/hrm.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  ActiveLoan,
  ContractTerms,
  PayrollInput,
  PayrollPeriod,
  PayslipResult,
  SalaryComponent,
} from '../domain/payroll.js';
import type { TaxCategory, TaxRules } from '../domain/tax.js';
import type {
  ContractView,
  LoanView,
  PayrollRepository,
  PayrollRunRow,
  PayrollStaff,
  PayslipDetail,
  PayslipSummary,
  RunStatus,
  TaxProfileRow,
  TaxYearRow,
} from '../application/payrollPorts.js';

const runCols = {
  id: payrollRun.id,
  campusId: payrollRun.campusId,
  periodMonth: payrollRun.periodMonth,
  status: payrollRun.status,
  includedComponents: payrollRun.includedComponents,
  grossPaisa: payrollRun.grossPaisa,
  deductionsPaisa: payrollRun.deductionsPaisa,
  netPaisa: payrollRun.netPaisa,
  computedAt: payrollRun.computedAt,
  submittedBy: payrollRun.submittedBy,
  submittedAt: payrollRun.submittedAt,
  approvedBy: payrollRun.approvedBy,
  approvedAt: payrollRun.approvedAt,
  decisionNote: payrollRun.decisionNote,
  lockedAt: payrollRun.lockedAt,
  paidAt: payrollRun.paidAt,
  paymentReference: payrollRun.paymentReference,
};

const summaryCols = {
  id: payslip.id,
  staffId: payslip.staffId,
  staffNo: staff.staffNo,
  name: staff.fullNameEn,
  workingDays: payslip.workingDays,
  paidDays: payslip.paidDays,
  lwpDays: payslip.lwpDays,
  grossPaisa: payslip.grossPaisa,
  deductionsPaisa: payslip.deductionsPaisa,
  taxPaisa: payslip.taxPaisa,
  netPaisa: payslip.netPaisa,
  employerContributionPaisa: payslip.employerContributionPaisa,
  warnings: payslip.warnings,
};

type SummaryRaw = Omit<PayslipSummary, 'workingDays' | 'paidDays' | 'lwpDays' | 'warnings'> & {
  workingDays: string;
  paidDays: string;
  lwpDays: string;
  warnings: unknown;
};
const toSummary = (r: SummaryRaw): PayslipSummary => ({
  ...r,
  workingDays: Number(r.workingDays),
  paidDays: Number(r.paidDays),
  lwpDays: Number(r.lwpDays),
  warnings: (r.warnings as PayslipSummary['warnings']) ?? [],
});

/**
 * Salary data. contract_component and payslip_line have no RLS of their own: every query reaches them through
 * the RLS-protected staff / payslip rows.
 */
export class DrizzlePayrollRepository implements PayrollRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async components(): Promise<SalaryComponent[]> {
    return this.tx
      .select({
        id: salaryComponent.id,
        code: salaryComponent.code,
        nameEn: salaryComponent.nameEn,
        kind: salaryComponent.kind,
        calc: salaryComponent.calc,
        seq: salaryComponent.seq,
        taxable: salaryComponent.taxable,
      })
      .from(salaryComponent)
      .orderBy(asc(salaryComponent.seq));
  }

  // ---------------- contracts ----------------
  async staffOf(id: string) {
    const [r] = await this.tx
      .select({ id: staff.id, campusId: staff.campusId, joinedOn: staff.joinedOn })
      .from(staff)
      .where(and(eq(staff.id, id), isNull(staff.deletedAt)));
    return r ?? null;
  }

  async insertContract(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(contract)
      .values(values as typeof contract.$inferInsert)
      .returning({ id: contract.id });
    return r!.id;
  }

  async replaceContractComponents(
    contractId: string,
    rows: Array<{ componentId: string; amountPaisa: number | null; percent: number | null }>,
  ): Promise<void> {
    await this.tx.delete(contractComponent).where(eq(contractComponent.contractId, contractId));
    if (rows.length)
      await this.tx.insert(contractComponent).values(
        rows.map((r) => ({
          contractId,
          componentId: r.componentId,
          amountPaisa: r.amountPaisa,
          percent: r.percent === null ? null : String(r.percent),
        })),
      );
  }

  private async withComponents(rows: Array<Omit<ContractView, 'components'>>): Promise<ContractView[]> {
    if (!rows.length) return [];
    const comps = await this.tx
      .select({
        contractId: contractComponent.contractId,
        componentId: contractComponent.componentId,
        code: salaryComponent.code,
        amountPaisa: contractComponent.amountPaisa,
        percent: contractComponent.percent,
      })
      .from(contractComponent)
      .innerJoin(salaryComponent, eq(salaryComponent.id, contractComponent.componentId))
      .where(
        inArray(
          contractComponent.contractId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(salaryComponent.seq));
    return rows.map((r) => ({
      ...r,
      components: comps
        .filter((c) => c.contractId === r.id)
        .map((c) => ({
          componentId: c.componentId,
          code: c.code,
          amountPaisa: c.amountPaisa,
          percent: c.percent === null ? null : Number(c.percent),
        })),
    }));
  }

  private contractQuery() {
    return this.tx
      .select({
        id: contract.id,
        staffId: contract.staffId,
        contractType: contract.contractType,
        startsOn: contract.startsOn,
        endsOn: contract.endsOn,
        probationEndsOn: contract.probationEndsOn,
        basicPaisa: contract.basicPaisa,
      })
      .from(contract)
      .innerJoin(staff, eq(staff.id, contract.staffId));
  }

  async contract(id: string): Promise<ContractView | null> {
    const [r] = await this.withComponents(await this.contractQuery().where(eq(contract.id, id)));
    return r ?? null;
  }

  async contractsOfStaff(staffId: string): Promise<ContractView[]> {
    return this.withComponents(
      await this.contractQuery().where(eq(contract.staffId, staffId)).orderBy(desc(contract.startsOn)),
    );
  }

  async endContract(id: string, endsOn: string): Promise<void> {
    await this.tx.update(contract).set({ endsOn }).where(eq(contract.id, id));
  }

  async contractTerms(staffIds: string[], period: PayrollPeriod): Promise<Map<string, ContractTerms[]>> {
    const out = new Map<string, ContractTerms[]>();
    if (!staffIds.length) return out;
    const rows = await this.withComponents(
      await this.contractQuery().where(
        and(
          inArray(contract.staffId, staffIds),
          lte(contract.startsOn, period.end),
          or(isNull(contract.endsOn), gte(contract.endsOn, period.start)),
        ),
      ),
    );
    for (const r of rows) {
      const list = out.get(r.staffId) ?? [];
      list.push({
        contractId: r.id,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        basicPaisa: r.basicPaisa,
        components: r.components.map((c) => ({
          componentId: c.componentId,
          amountPaisa: c.amountPaisa,
          percent: c.percent,
        })),
      });
      out.set(r.staffId, list);
    }
    return out;
  }

  // ---------------- runs ----------------
  async payrollStaff(campusId: string, period: PayrollPeriod): Promise<PayrollStaff[]> {
    return this.tx
      .selectDistinct({
        staffId: staff.id,
        staffNo: staff.staffNo,
        name: staff.fullNameEn,
        joinedOn: staff.joinedOn,
        leftOn: staff.leftOn,
      })
      .from(staff)
      .innerJoin(contract, eq(contract.staffId, staff.id))
      .where(
        and(
          eq(staff.campusId, campusId),
          isNull(staff.deletedAt),
          lte(staff.joinedOn, period.end),
          or(isNull(staff.leftOn), gte(staff.leftOn, period.start)),
          lte(contract.startsOn, period.end),
          or(isNull(contract.endsOn), gte(contract.endsOn, period.start)),
        ),
      )
      .orderBy(asc(staff.staffNo));
  }

  async insertRun(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(payrollRun)
      .values(values as typeof payrollRun.$inferInsert)
      .returning({ id: payrollRun.id });
    return r!.id;
  }

  async run(id: string, forUpdate: boolean): Promise<PayrollRunRow | null> {
    const q = this.tx.select(runCols).from(payrollRun).where(eq(payrollRun.id, id));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async runs(f: { campusId?: string; year?: number }): Promise<PayrollRunRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(payrollRun.campusId, f.campusId));
    if (f.year)
      where.push(gte(payrollRun.periodMonth, `${f.year}-01-01`), lte(payrollRun.periodMonth, `${f.year}-12-01`));
    return this.tx
      .select(runCols)
      .from(payrollRun)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payrollRun.periodMonth));
  }

  async updateRun(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(payrollRun).set(patch).where(eq(payrollRun.id, id));
  }

  async inputs(runId: string): Promise<Map<string, PayrollInput>> {
    const rows = await this.tx.select().from(payrollInput).where(eq(payrollInput.payrollRunId, runId));
    return new Map(
      rows.map((r) => [
        r.staffId,
        {
          lwpDays: Number(r.lwpDays),
          overtimeMinutes: r.overtimeMinutes,
          coverPeriods: r.coverPeriods,
          adjustments: (r.adjustments as PayrollInput['adjustments']) ?? [],
        },
      ]),
    );
  }

  async upsertInputs(
    run: { id: string; orgId: string; campusId: string },
    rows: Array<{ staffId: string } & PayrollInput>,
  ): Promise<void> {
    for (const r of rows) {
      const values = {
        lwpDays: String(r.lwpDays),
        overtimeMinutes: r.overtimeMinutes,
        coverPeriods: r.coverPeriods,
        adjustments: r.adjustments,
      };
      await this.tx
        .insert(payrollInput)
        .values({ payrollRunId: run.id, staffId: r.staffId, orgId: run.orgId, campusId: run.campusId, ...values })
        .onConflictDoUpdate({
          target: [payrollInput.payrollRunId, payrollInput.staffId],
          set: { ...values, updatedAt: sql`now()` },
        });
    }
  }

  async activeLoans(staffIds: string[], periodStart: string): Promise<Map<string, ActiveLoan[]>> {
    const out = new Map<string, ActiveLoan[]>();
    if (!staffIds.length) return out;
    const rows = await this.tx
      .select({
        staffId: staffLoan.staffId,
        loanId: staffLoan.id,
        kind: staffLoan.kind,
        installmentPaisa: staffLoan.installmentPaisa,
        outstandingPaisa: staffLoan.outstandingPaisa,
      })
      .from(staffLoan)
      .where(
        and(
          inArray(staffLoan.staffId, staffIds),
          eq(staffLoan.status, 'active'),
          gt(staffLoan.outstandingPaisa, 0),
          lte(staffLoan.startsMonth, periodStart),
        ),
      )
      .orderBy(asc(staffLoan.startsMonth), asc(staffLoan.id));
    for (const { staffId, ...loan } of rows) out.set(staffId, [...(out.get(staffId) ?? []), loan]);
    return out;
  }

  async clearComputation(runId: string): Promise<void> {
    await this.tx.delete(loanRecovery).where(eq(loanRecovery.payrollRunId, runId));
    await this.tx.delete(payslip).where(eq(payslip.payrollRunId, runId)); // lines cascade
  }

  async insertPayslip(
    run: { id: string; orgId: string; campusId: string },
    staffId: string,
    r: PayslipResult,
  ): Promise<void> {
    const [p] = await this.tx
      .insert(payslip)
      .values({
        payrollRunId: run.id,
        staffId,
        orgId: run.orgId,
        campusId: run.campusId,
        workingDays: String(r.workingDays),
        paidDays: String(r.paidDays),
        lwpDays: String(r.lwpDays),
        coverPeriods: r.coverPeriods,
        overtimeMinutes: r.overtimeMinutes,
        grossPaisa: r.grossPaisa,
        deductionsPaisa: r.deductionsPaisa,
        taxPaisa: r.taxPaisa,
        netPaisa: r.netPaisa,
        employerContributionPaisa: r.employerContributionPaisa,
        taxablePaisa: r.taxablePaisa,
        warnings: r.warnings,
      })
      .returning({ id: payslip.id });
    if (r.lines.length)
      await this.tx.insert(payslipLine).values(
        r.lines.map((l) => ({
          payslipId: p!.id,
          componentId: l.componentId,
          kind: l.kind,
          quantity: l.quantity === null ? null : String(l.quantity),
          amountPaisa: l.amountPaisa,
          note: l.note,
        })),
      );
  }

  async insertRecoveries(
    orgId: string,
    runId: string,
    rows: Array<{ loanId: string; amountPaisa: number }>,
    on: string,
  ): Promise<void> {
    if (!rows.length) return;
    await this.tx.insert(loanRecovery).values(
      rows.map((r) => ({
        orgId,
        staffLoanId: r.loanId,
        payrollRunId: runId,
        amountPaisa: r.amountPaisa,
        recoveredOn: on,
      })),
    );
  }

  async applyRecoveries(runId: string): Promise<number> {
    const res = await this.tx.execute(sql`
      UPDATE hrm.staff_loan l
         SET outstanding_paisa = l.outstanding_paisa - r.amount_paisa,
             status = CASE WHEN l.outstanding_paisa - r.amount_paisa = 0 THEN 'closed' ELSE l.status END
        FROM hrm.loan_recovery r
       WHERE r.staff_loan_id = l.id AND r.payroll_run_id = ${runId}`);
    return res.rowCount ?? 0;
  }

  async componentTotals(runId: string) {
    const rows = await this.tx
      .select({
        code: salaryComponent.code,
        kind: payslipLine.kind,
        amountPaisa: sql<number>`sum(${payslipLine.amountPaisa})::bigint`,
      })
      .from(payslipLine)
      .innerJoin(payslip, eq(payslip.id, payslipLine.payslipId))
      .innerJoin(salaryComponent, eq(salaryComponent.id, payslipLine.componentId))
      .where(eq(payslip.payrollRunId, runId))
      .groupBy(salaryComponent.code, payslipLine.kind)
      .orderBy(asc(salaryComponent.code));
    return rows.map((r) => ({ ...r, amountPaisa: Number(r.amountPaisa) }));
  }

  async totals(runId: string) {
    const [r] = await this.tx
      .select({
        count: sql<number>`count(*)::int`,
        gross: sql<number>`coalesce(sum(${payslip.grossPaisa}), 0)::bigint`,
        deductions: sql<number>`coalesce(sum(${payslip.deductionsPaisa}), 0)::bigint`,
        net: sql<number>`coalesce(sum(${payslip.netPaisa}), 0)::bigint`,
        negative: sql<number>`(count(*) FILTER (WHERE ${payslip.netPaisa} < 0))::int`,
      })
      .from(payslip)
      .where(eq(payslip.payrollRunId, runId));
    return {
      count: r?.count ?? 0,
      gross: Number(r?.gross ?? 0),
      deductions: Number(r?.deductions ?? 0),
      net: Number(r?.net ?? 0),
      negative: r?.negative ?? 0,
    };
  }

  async sheet(runId: string): Promise<PayslipSummary[]> {
    const rows = await this.tx
      .select(summaryCols)
      .from(payslip)
      .innerJoin(staff, eq(staff.id, payslip.staffId))
      .where(eq(payslip.payrollRunId, runId))
      .orderBy(asc(staff.staffNo));
    return rows.map(toSummary);
  }

  async payslip(id: string): Promise<PayslipDetail | null> {
    const [r] = await this.tx
      .select({
        ...summaryCols,
        payrollRunId: payslip.payrollRunId,
        campusId: payslip.campusId,
        periodMonth: payrollRun.periodMonth,
        runStatus: payrollRun.status,
        coverPeriods: payslip.coverPeriods,
        overtimeMinutes: payslip.overtimeMinutes,
      })
      .from(payslip)
      .innerJoin(staff, eq(staff.id, payslip.staffId))
      .innerJoin(payrollRun, eq(payrollRun.id, payslip.payrollRunId))
      .where(eq(payslip.id, id));
    if (!r) return null;
    const lines = await this.tx
      .select({
        code: salaryComponent.code,
        name: salaryComponent.nameEn,
        kind: payslipLine.kind,
        quantity: payslipLine.quantity,
        amountPaisa: payslipLine.amountPaisa,
        note: payslipLine.note,
        seq: salaryComponent.seq,
      })
      .from(payslipLine)
      .innerJoin(salaryComponent, eq(salaryComponent.id, payslipLine.componentId))
      .where(eq(payslipLine.payslipId, id))
      .orderBy(asc(payslipLine.kind), asc(salaryComponent.seq));
    const { payrollRunId, campusId, periodMonth, runStatus, coverPeriods, overtimeMinutes, ...summary } = r;
    return {
      ...toSummary(summary),
      payrollRunId,
      campusId,
      periodMonth,
      runStatus,
      coverPeriods,
      overtimeMinutes,
      lines: lines.map(({ seq: _seq, ...l }) => ({ ...l, quantity: l.quantity === null ? null : Number(l.quantity) })),
    };
  }

  async payslipsOfStaff(staffId: string) {
    const rows = await this.tx
      .select({ ...summaryCols, periodMonth: payrollRun.periodMonth, runStatus: payrollRun.status })
      .from(payslip)
      .innerJoin(staff, eq(staff.id, payslip.staffId))
      .innerJoin(payrollRun, eq(payrollRun.id, payslip.payrollRunId))
      .where(and(eq(payslip.staffId, staffId), inArray(payrollRun.status, ['locked', 'paid'])))
      .orderBy(desc(payrollRun.periodMonth));
    return rows.map(({ periodMonth, runStatus, ...s }) => ({
      ...toSummary(s),
      periodMonth,
      runStatus: runStatus as RunStatus,
    }));
  }

  async bankAdvice(runId: string) {
    return this.tx
      .select({
        staffNo: staff.staffNo,
        name: staff.fullNameEn,
        bankAccountEnc: staff.bankAccountEnc,
        netPaisa: payslip.netPaisa,
      })
      .from(payslip)
      .innerJoin(staff, eq(staff.id, payslip.staffId))
      .where(and(eq(payslip.payrollRunId, runId), gt(payslip.netPaisa, 0)))
      .orderBy(asc(staff.staffNo));
  }

  async setBankAccount(staffId: string, enc: Buffer | null): Promise<boolean> {
    const rows = await this.tx
      .update(staff)
      .set({ bankAccountEnc: enc })
      .where(eq(staff.id, staffId))
      .returning({ id: staff.id });
    return rows.length > 0;
  }

  // ---------------- tax ----------------
  private readonly taxYearCols = {
    code: taxYear.code,
    startsOn: taxYear.startsOn,
    endsOn: taxYear.endsOn,
    rules: taxYear.rules,
    sourceNote: taxYear.sourceNote,
    verifiedBy: taxYear.verifiedBy,
    verifiedAt: taxYear.verifiedAt,
  };

  async taxYearFor(date: string): Promise<TaxYearRow | null> {
    const [r] = await this.tx
      .select(this.taxYearCols)
      .from(taxYear)
      .where(and(lte(taxYear.startsOn, date), gte(taxYear.endsOn, date)));
    return r ? { ...r, rules: r.rules as TaxRules } : null;
  }

  async taxYears(): Promise<TaxYearRow[]> {
    const rows = await this.tx.select(this.taxYearCols).from(taxYear).orderBy(desc(taxYear.startsOn));
    return rows.map((r) => ({ ...r, rules: r.rules as TaxRules }));
  }

  async upsertTaxYear(orgId: string, row: Omit<TaxYearRow, 'verifiedBy' | 'verifiedAt'>): Promise<void> {
    const values = { startsOn: row.startsOn, endsOn: row.endsOn, rules: row.rules, sourceNote: row.sourceNote };
    // any change of the rules needs a fresh verification
    await this.tx
      .insert(taxYear)
      .values({ orgId, code: row.code, ...values })
      .onConflictDoUpdate({
        target: [taxYear.orgId, taxYear.code],
        set: { ...values, verifiedBy: null, verifiedAt: null },
      });
  }

  async verifyTaxYear(code: string, by: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(taxYear)
      .set({ verifiedBy: by, verifiedAt: at })
      .where(eq(taxYear.code, code))
      .returning({ code: taxYear.code });
    return rows.length > 0;
  }

  async taxProfiles(staffIds: string[], taxYearCode: string): Promise<Map<string, TaxProfileRow>> {
    if (!staffIds.length) return new Map();
    const rows = await this.tx
      .select({
        staffId: staffTaxProfile.staffId,
        taxYearCode: staffTaxProfile.taxYearCode,
        category: staffTaxProfile.category,
        declaredInvestmentPaisa: staffTaxProfile.declaredInvestmentPaisa,
        disabledChildren: staffTaxProfile.disabledChildren,
        newTaxpayer: staffTaxProfile.newTaxpayer,
      })
      .from(staffTaxProfile)
      .where(and(inArray(staffTaxProfile.staffId, staffIds), eq(staffTaxProfile.taxYearCode, taxYearCode)));
    return new Map(rows.map((r) => [r.staffId, { ...r, category: r.category as TaxCategory }]));
  }

  async upsertTaxProfile(orgId: string, row: TaxProfileRow): Promise<void> {
    const values = {
      category: row.category,
      declaredInvestmentPaisa: row.declaredInvestmentPaisa,
      disabledChildren: row.disabledChildren,
      newTaxpayer: row.newTaxpayer,
    };
    await this.tx
      .insert(staffTaxProfile)
      .values({ orgId, staffId: row.staffId, taxYearCode: row.taxYearCode, ...values })
      .onConflictDoUpdate({
        target: [staffTaxProfile.staffId, staffTaxProfile.taxYearCode],
        set: { ...values, updatedAt: sql`now()` },
      });
  }

  async taxYtd(staffIds: string[], from: string, before: string) {
    const out = new Map<string, { taxable: number; tax: number }>();
    if (!staffIds.length) return out;
    const rows = await this.tx
      .select({
        staffId: payslip.staffId,
        taxable: sql<number>`coalesce(sum(${payslip.taxablePaisa}), 0)::bigint`,
        tax: sql<number>`coalesce(sum(${payslip.taxPaisa}), 0)::bigint`,
      })
      .from(payslip)
      .innerJoin(payrollRun, eq(payrollRun.id, payslip.payrollRunId))
      .where(
        and(
          inArray(payslip.staffId, staffIds),
          inArray(payrollRun.status, ['locked', 'paid']),
          gte(payrollRun.periodMonth, from),
          lt(payrollRun.periodMonth, before),
        ),
      )
      .groupBy(payslip.staffId);
    for (const r of rows) out.set(r.staffId, { taxable: Number(r.taxable), tax: Number(r.tax) });
    return out;
  }

  // ---------------- loans ----------------
  async insertLoan(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(staffLoan)
      .values(values as typeof staffLoan.$inferInsert)
      .returning({ id: staffLoan.id });
    return r!.id;
  }

  async loans(f: { staffId?: string; status?: string }): Promise<LoanView[]> {
    return this.tx
      .select({
        id: staffLoan.id,
        staffId: staffLoan.staffId,
        kind: staffLoan.kind,
        principalPaisa: staffLoan.principalPaisa,
        installmentPaisa: staffLoan.installmentPaisa,
        outstandingPaisa: staffLoan.outstandingPaisa,
        startsMonth: staffLoan.startsMonth,
        status: staffLoan.status,
        reason: staffLoan.reason,
      })
      .from(staffLoan)
      .innerJoin(staff, eq(staff.id, staffLoan.staffId))
      .where(
        and(
          f.staffId ? eq(staffLoan.staffId, f.staffId) : undefined,
          f.status ? eq(staffLoan.status, f.status as LoanView['status'] as never) : undefined,
        ),
      )
      .orderBy(desc(staffLoan.startsMonth));
  }
}
