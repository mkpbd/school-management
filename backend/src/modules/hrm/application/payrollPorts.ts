import type {
  ActiveLoan,
  ContractTerms,
  PayrollInput,
  PayrollPeriod,
  PayslipResult,
  SalaryComponent,
} from '../domain/payroll.js';
import type { TaxCategory, TaxRules } from '../domain/tax.js';

export type RunStatus = 'draft' | 'computed' | 'submitted' | 'approved' | 'locked' | 'paid' | 'cancelled';

export interface PayrollRunRow {
  id: string;
  campusId: string;
  periodMonth: string;
  status: RunStatus;
  includedComponents: string[];
  grossPaisa: number | null;
  deductionsPaisa: number | null;
  netPaisa: number | null;
  computedAt: Date | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  decisionNote: string | null;
  lockedAt: Date | null;
  paidAt: Date | null;
  paymentReference: string | null;
}

export interface PayrollStaff {
  staffId: string;
  staffNo: string;
  name: string;
  joinedOn: string;
  leftOn: string | null;
}

export interface PayslipSummary {
  id: string;
  staffId: string;
  staffNo: string;
  name: string;
  workingDays: number;
  paidDays: number;
  lwpDays: number;
  grossPaisa: number;
  deductionsPaisa: number;
  taxPaisa: number;
  netPaisa: number;
  employerContributionPaisa: number;
  warnings: Array<{ code: string; message: string }>;
}

export interface PayslipDetail extends PayslipSummary {
  payrollRunId: string;
  campusId: string;
  periodMonth: string;
  runStatus: RunStatus;
  coverPeriods: number;
  overtimeMinutes: number;
  lines: Array<{
    code: string;
    name: string;
    kind: string;
    quantity: number | null;
    amountPaisa: number;
    note: string | null;
  }>;
}

export interface ContractView {
  id: string;
  staffId: string;
  contractType: string;
  startsOn: string;
  endsOn: string | null;
  probationEndsOn: string | null;
  basicPaisa: number;
  components: Array<{ componentId: string; code: string; amountPaisa: number | null; percent: number | null }>;
}

export interface LoanView {
  id: string;
  staffId: string;
  kind: 'loan' | 'advance';
  principalPaisa: number;
  installmentPaisa: number;
  outstandingPaisa: number;
  startsMonth: string;
  status: string;
  reason: string | null;
}

export interface TaxYearRow {
  code: string;
  startsOn: string;
  endsOn: string;
  rules: TaxRules;
  sourceNote: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
}

export interface TaxProfileRow {
  staffId: string;
  taxYearCode: string;
  category: TaxCategory;
  declaredInvestmentPaisa: number;
  disabledChildren: number;
  newTaxpayer: boolean;
}

export interface PayrollRepository {
  components(): Promise<SalaryComponent[]>;
  // contracts
  staffOf(id: string): Promise<{ id: string; campusId: string; joinedOn: string } | null>;
  insertContract(values: Record<string, unknown>): Promise<string>;
  replaceContractComponents(
    contractId: string,
    rows: Array<{ componentId: string; amountPaisa: number | null; percent: number | null }>,
  ): Promise<void>;
  contract(id: string): Promise<ContractView | null>;
  contractsOfStaff(staffId: string): Promise<ContractView[]>;
  endContract(id: string, endsOn: string): Promise<void>;
  contractTerms(staffIds: string[], period: PayrollPeriod): Promise<Map<string, ContractTerms[]>>;
  // runs
  payrollStaff(campusId: string, period: PayrollPeriod): Promise<PayrollStaff[]>;
  insertRun(values: Record<string, unknown>): Promise<string>;
  run(id: string, forUpdate: boolean): Promise<PayrollRunRow | null>;
  runs(f: { campusId?: string; year?: number }): Promise<PayrollRunRow[]>;
  updateRun(id: string, patch: Record<string, unknown>): Promise<void>;
  inputs(runId: string): Promise<Map<string, PayrollInput>>;
  upsertInputs(
    run: { id: string; orgId: string; campusId: string },
    rows: Array<{ staffId: string } & PayrollInput>,
  ): Promise<void>;
  activeLoans(staffIds: string[], periodStart: string): Promise<Map<string, ActiveLoan[]>>;
  clearComputation(runId: string): Promise<void>;
  insertPayslip(run: { id: string; orgId: string; campusId: string }, staffId: string, r: PayslipResult): Promise<void>;
  insertRecoveries(
    orgId: string,
    runId: string,
    rows: Array<{ loanId: string; amountPaisa: number }>,
    on: string,
  ): Promise<void>;
  applyRecoveries(runId: string): Promise<number>;
  /** run totals per salary component (accounting posting) */
  componentTotals(runId: string): Promise<Array<{ code: string; kind: string; amountPaisa: number }>>;
  totals(runId: string): Promise<{ count: number; gross: number; deductions: number; net: number; negative: number }>;
  sheet(runId: string): Promise<PayslipSummary[]>;
  payslip(id: string): Promise<PayslipDetail | null>;
  payslipsOfStaff(staffId: string): Promise<Array<PayslipSummary & { periodMonth: string; runStatus: RunStatus }>>;
  bankAdvice(
    runId: string,
  ): Promise<Array<{ staffNo: string; name: string; bankAccountEnc: Buffer | null; netPaisa: number }>>;
  setBankAccount(staffId: string, enc: Buffer | null): Promise<boolean>;
  // tax
  taxYearFor(date: string): Promise<TaxYearRow | null>;
  taxYears(): Promise<TaxYearRow[]>;
  upsertTaxYear(orgId: string, row: Omit<TaxYearRow, 'verifiedBy' | 'verifiedAt'>): Promise<void>;
  verifyTaxYear(code: string, by: string, at: Date): Promise<boolean>;
  taxProfiles(staffIds: string[], taxYearCode: string): Promise<Map<string, TaxProfileRow>>;
  upsertTaxProfile(orgId: string, row: TaxProfileRow): Promise<void>;
  /** taxable salary and tax of locked / paid payslips with from <= month < before */
  taxYtd(staffIds: string[], from: string, before: string): Promise<Map<string, { taxable: number; tax: number }>>;
  // loans
  insertLoan(values: Record<string, unknown>): Promise<string>;
  loans(f: { staffId?: string; status?: string }): Promise<LoanView[]>;
}
