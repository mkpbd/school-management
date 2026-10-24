import { InvariantError } from '../../../shared/domain/errors.js';
import { monthlyTds, type AnnualTax, type TdsContext } from './tax.js';

export type ComponentKind = 'earning' | 'deduction' | 'employer_contribution';
export type ComponentCalc = 'fixed' | 'percent_of_basic' | 'per_unit' | 'formula';

export interface SalaryComponent {
  id: string;
  code: string;
  nameEn: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  seq: number;
  /** earnings only: counts as taxable salary (default true) */
  taxable?: boolean;
}

export interface ContractTerms {
  contractId: string;
  startsOn: string;
  endsOn: string | null;
  basicPaisa: number;
  /** amount (fixed / per-unit rate) or percent (of basic) per component */
  components: Array<{ componentId: string; amountPaisa: number | null; percent: number | null }>;
}

export interface PayrollInput {
  lwpDays: number;
  overtimeMinutes: number;
  coverPeriods: number;
  adjustments: Array<{ componentCode: string; amountPaisa: number; note?: string }>;
}

export interface ActiveLoan {
  loanId: string;
  kind: 'loan' | 'advance';
  installmentPaisa: number;
  outstandingPaisa: number;
}

export interface PayrollPeriod {
  /** first and last day of the month, YYYY-MM-DD */
  start: string;
  end: string;
}

export interface PayslipLine {
  componentId: string;
  code: string;
  kind: ComponentKind;
  quantity: number | null;
  amountPaisa: number;
  note: string | null;
}

export interface PayslipResult {
  workingDays: number;
  employedDays: number;
  paidDays: number;
  lwpDays: number;
  coverPeriods: number;
  overtimeMinutes: number;
  lines: PayslipLine[];
  grossPaisa: number;
  deductionsPaisa: number;
  taxPaisa: number;
  netPaisa: number;
  employerContributionPaisa: number;
  /** taxable salary of the month (taxable earnings less unpaid leave) */
  taxablePaisa: number;
  /** set when TDS was computed automatically */
  tax: { mode: 'auto'; projectedAnnual: AnnualTax } | { mode: 'contract' | 'none' };
  loanRecoveries: Array<{ loanId: string; amountPaisa: number }>;
  warnings: Array<{ code: string; message: string }>;
}

/** Codes with a fixed meaning; everything else is configured per organisation. */
export const CODES = {
  basic: 'BASIC',
  lwp: 'LWP',
  overtime: 'OT',
  cover: 'COVER_PAY',
  tax: 'TAX',
  loan: 'LOAN',
  advance: 'ADVANCE',
} as const;

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** inclusive day count of the overlap of [a1, a2] and [b1, b2] (null end = open) */
function overlapDays(a1: string, a2: string | null, b1: string, b2: string): number {
  const from = Math.max(toTime(a1), toTime(b1));
  const to = Math.min(a2 ? toTime(a2) : Infinity, toTime(b2));
  return to < from ? 0 : Math.round((to - from) / DAY) + 1;
}

/**
 * Monthly payslip for one staff member (HRM-04), calendar-day basis:
 *  - every contract segment in the month is pro-rated by the days it covers (joiners, leavers, contract changes);
 *  - fixed and percent-of-basic components follow the segment; per-unit ones (OT per hour, cover pay per period)
 *    use the latest rate;
 *  - unpaid leave (LWP) deducts the daily rate of the month's fixed earnings;
 *  - occasional components (festival bonus) only when the run includes them;
 *  - income tax: a TAX amount on the contract is a fixed deduction; otherwise, with a tax table (`tds`), monthly
 *    TDS from the projected annual salary (see tax.ts);
 *  - loan / advance installments come last and are reduced so net pay never goes below zero.
 * All amounts are integer paisa, rounded per line.
 */
export function computePayslip(i: {
  period: PayrollPeriod;
  staff: { joinedOn: string; leftOn: string | null };
  contracts: ContractTerms[];
  components: SalaryComponent[];
  input: PayrollInput;
  loans: ActiveLoan[];
  occasionalCodes: string[];
  includedCodes: string[];
  tds?: TdsContext;
}): PayslipResult {
  const byId = new Map(i.components.map((c) => [c.id, c]));
  const byCode = new Map(i.components.map((c) => [c.code, c]));
  const required = (code: string) => {
    const c = byCode.get(code);
    if (!c) throw new InvariantError('PAYROLL_SETUP', `Salary component ${code} is not configured`);
    return c;
  };
  const warnings: PayslipResult['warnings'] = [];
  const workingDays = overlapDays(i.period.start, i.period.end, i.period.start, i.period.end);
  const amounts = new Map<string, { amount: number; quantity: number | null; note: string | null }>();
  const add = (componentId: string, amount: number, quantity: number | null = null, note: string | null = null) => {
    const prev = amounts.get(componentId);
    amounts.set(componentId, {
      amount: (prev?.amount ?? 0) + amount,
      quantity: quantity ?? prev?.quantity ?? null,
      note: note ?? prev?.note ?? null,
    });
  };

  // 1. contract segments
  const basic = required(CODES.basic);
  let employedDays = 0;
  let fixedEarnings = 0; // base for the unpaid-leave daily rate
  const contracts = [...i.contracts].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  for (const c of contracts) {
    const from = [c.startsOn, i.staff.joinedOn].sort().at(-1)!;
    const ends = [c.endsOn, i.staff.leftOn].filter((x): x is string => !!x).sort()[0] ?? null;
    const days = overlapDays(from, ends, i.period.start, i.period.end);
    if (!days) continue;
    employedDays += days;
    const f = days / workingDays;
    add(basic.id, c.basicPaisa * f);
    fixedEarnings += c.basicPaisa * f;
    for (const cc of c.components) {
      const comp = byId.get(cc.componentId);
      // occasional components are paid once below; per-unit ones after the segments; formulas are warned about
      if (!comp || comp.code === CODES.basic || i.occasionalCodes.includes(comp.code)) continue;
      let value: number;
      if (comp.calc === 'fixed') value = (cc.amountPaisa ?? 0) * f;
      else if (comp.calc === 'percent_of_basic') value = (c.basicPaisa * (cc.percent ?? 0) * f) / 100;
      else continue;
      add(comp.id, value);
      if (comp.kind === 'earning') fixedEarnings += value;
    }
  }
  if (!employedDays) throw new InvariantError('NOT_EMPLOYED', 'No contract covers this month');

  // 2. per-unit components from the latest contract's rates; occasional ones (festival bonus) once, in full,
  //    not pro-rated by days (eligibility is the run's decision)
  const latest = contracts.filter((c) => overlapDays(c.startsOn, c.endsOn, i.period.start, i.period.end)).at(-1)!;
  for (const cc of latest.components) {
    const comp = byId.get(cc.componentId);
    if (!comp) continue;
    if (i.occasionalCodes.includes(comp.code)) {
      if (!i.includedCodes.includes(comp.code)) continue;
      if (comp.calc === 'fixed') add(comp.id, cc.amountPaisa ?? 0);
      else if (comp.calc === 'percent_of_basic') add(comp.id, (latest.basicPaisa * (cc.percent ?? 0)) / 100);
      continue;
    }
    if (comp.calc === 'formula') {
      warnings.push({ code: 'FORMULA_UNSUPPORTED', message: `${comp.code} uses a formula and was skipped` });
      continue;
    }
    if (comp.calc !== 'per_unit') continue;
    const qty =
      comp.code === CODES.overtime
        ? i.input.overtimeMinutes / 60
        : comp.code === CODES.cover
          ? i.input.coverPeriods
          : 0;
    if (qty > 0) add(comp.id, (cc.amountPaisa ?? 0) * qty, Math.round(qty * 100) / 100);
  }
  if (i.input.overtimeMinutes > 0 && !latest.components.some((cc) => byId.get(cc.componentId)?.code === CODES.overtime))
    warnings.push({ code: 'NO_OT_RATE', message: 'Overtime entered but the contract has no OT rate' });
  if (i.input.coverPeriods > 0 && !latest.components.some((cc) => byId.get(cc.componentId)?.code === CODES.cover))
    warnings.push({ code: 'NO_COVER_RATE', message: 'Cover periods entered but the contract has no cover pay rate' });

  // 3. unpaid leave
  const lwpDays = Math.min(i.input.lwpDays, employedDays);
  if (i.input.lwpDays > employedDays)
    warnings.push({ code: 'LWP_CAPPED', message: `Unpaid leave capped at ${employedDays} employed days` });
  if (lwpDays > 0) add(required(CODES.lwp).id, (fixedEarnings / employedDays) * lwpDays, lwpDays);

  // 4. one-off adjustments
  for (const a of i.input.adjustments) {
    const comp = byCode.get(a.componentCode);
    if (!comp) throw new InvariantError('COMPONENT_UNKNOWN', `Unknown salary component ${a.componentCode}`);
    add(comp.id, a.amountPaisa, null, a.note ?? null);
  }

  // 5. totals before loans
  let lines: PayslipLine[] = [...amounts.entries()]
    .map(([componentId, v]) => {
      const comp = byId.get(componentId)!;
      return {
        componentId,
        code: comp.code,
        kind: comp.kind,
        quantity: v.quantity,
        amountPaisa: Math.round(v.amount),
        note: v.note,
      };
    })
    .filter((l) => l.amountPaisa !== 0);
  const sum = (kind: ComponentKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amountPaisa, 0);
  const gross = sum('earning');
  let deductions = sum('deduction');

  // 6. income tax
  const isTaxable = (l: PayslipLine) => l.kind === 'earning' && byId.get(l.componentId)!.taxable !== false;
  const lwpLine = lines.find((l) => l.code === CODES.lwp);
  const taxable = Math.max(
    0,
    lines.filter(isTaxable).reduce((s, l) => s + l.amountPaisa, 0) - (lwpLine?.amountPaisa ?? 0),
  );
  let tax: PayslipResult['tax'] = { mode: lines.some((l) => l.code === CODES.tax) ? 'contract' : 'none' };
  if (i.tds && tax.mode === 'none') {
    // a full regular month of the latest contract (no bonus, no one-offs) for the rest of the income year
    let regular = byId.get(basic.id)!.taxable === false ? 0 : latest.basicPaisa;
    for (const cc of latest.components) {
      const comp = byId.get(cc.componentId);
      if (!comp || comp.kind !== 'earning' || comp.taxable === false || i.occasionalCodes.includes(comp.code)) continue;
      if (comp.calc === 'fixed') regular += cc.amountPaisa ?? 0;
      else if (comp.calc === 'percent_of_basic') regular += (latest.basicPaisa * (cc.percent ?? 0)) / 100;
    }
    const { tdsPaisa, projectedAnnual } = monthlyTds(i.tds, taxable, Math.round(regular));
    tax = { mode: 'auto', projectedAnnual };
    if (tdsPaisa > 0) {
      const comp = required(CODES.tax);
      lines.push({
        componentId: comp.id,
        code: comp.code,
        kind: 'deduction',
        quantity: null,
        amountPaisa: tdsPaisa,
        note: 'TDS',
      });
      deductions += tdsPaisa;
    }
  }

  // 7. loans last, never below zero net
  const loanRecoveries: PayslipResult['loanRecoveries'] = [];
  let room = Math.max(0, gross - deductions);
  for (const loan of i.loans) {
    const due = Math.min(loan.installmentPaisa, loan.outstandingPaisa);
    const take = Math.min(due, room);
    if (take < due)
      warnings.push({ code: 'LOAN_REDUCED', message: `Installment of ${loan.kind} reduced to keep net pay positive` });
    if (take <= 0) continue;
    room -= take;
    deductions += take;
    loanRecoveries.push({ loanId: loan.loanId, amountPaisa: take });
    const comp = required(loan.kind === 'loan' ? CODES.loan : CODES.advance);
    const existing = lines.find((l) => l.componentId === comp.id);
    if (existing) existing.amountPaisa += take;
    else
      lines.push({
        componentId: comp.id,
        code: comp.code,
        kind: 'deduction',
        quantity: null,
        amountPaisa: take,
        note: null,
      });
  }

  const net = gross - deductions;
  if (net < 0) warnings.push({ code: 'NEGATIVE_NET', message: 'Deductions exceed earnings' });
  const seq = (l: PayslipLine) => byId.get(l.componentId)!.seq;
  const kindOrder: Record<ComponentKind, number> = { earning: 0, deduction: 1, employer_contribution: 2 };
  lines = lines.sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || seq(a) - seq(b) || a.code.localeCompare(b.code),
  );
  return {
    workingDays,
    employedDays,
    paidDays: employedDays - lwpDays,
    lwpDays,
    coverPeriods: i.input.coverPeriods,
    overtimeMinutes: i.input.overtimeMinutes,
    lines,
    grossPaisa: gross,
    deductionsPaisa: deductions,
    taxPaisa: lines.filter((l) => l.code === CODES.tax).reduce((s, l) => s + l.amountPaisa, 0),
    netPaisa: net,
    employerContributionPaisa: sum('employer_contribution'),
    taxablePaisa: taxable,
    tax,
    loanRecoveries,
    warnings,
  };
}

/** 'YYYY-MM' -> first / last day. */
export function periodOf(month: string): PayrollPeriod {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new InvariantError('PERIOD_INVALID', 'Month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}
