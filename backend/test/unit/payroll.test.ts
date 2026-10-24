import { describe, expect, it } from 'vitest';
import {
  computePayslip,
  periodOf,
  type ContractTerms,
  type PayrollInput,
  type SalaryComponent,
} from '../../src/modules/hrm/domain/payroll.js';

const comp = (code: string, kind: SalaryComponent['kind'], calc: SalaryComponent['calc'], seq: number) => ({
  id: `c-${code}`,
  code,
  nameEn: code,
  kind,
  calc,
  seq,
});
const COMPONENTS: SalaryComponent[] = [
  comp('BASIC', 'earning', 'fixed', 10),
  comp('HOUSE', 'earning', 'percent_of_basic', 20),
  comp('MEDICAL', 'earning', 'fixed', 30),
  comp('COVER_PAY', 'earning', 'per_unit', 50),
  comp('OT', 'earning', 'per_unit', 60),
  comp('FEST_BONUS', 'earning', 'percent_of_basic', 70),
  comp('OTHER_EARNING', 'earning', 'fixed', 80),
  comp('PF', 'deduction', 'percent_of_basic', 110),
  comp('TAX', 'deduction', 'fixed', 120),
  comp('LWP', 'deduction', 'per_unit', 130),
  comp('LOAN', 'deduction', 'fixed', 140),
  comp('ADVANCE', 'deduction', 'fixed', 150),
  comp('PF_EMPLOYER', 'employer_contribution', 'percent_of_basic', 210),
];
const terms = (basicPaisa: number, startsOn = '2090-01-01', endsOn: string | null = null): ContractTerms => ({
  contractId: `k-${startsOn}`,
  startsOn,
  endsOn,
  basicPaisa,
  components: [
    { componentId: 'c-HOUSE', amountPaisa: null, percent: 50 },
    { componentId: 'c-MEDICAL', amountPaisa: 200_000, percent: null },
    { componentId: 'c-OT', amountPaisa: 20_000, percent: null }, // Tk 200 per hour
    { componentId: 'c-COVER_PAY', amountPaisa: 30_000, percent: null }, // Tk 300 per period
    { componentId: 'c-FEST_BONUS', amountPaisa: null, percent: 100 },
    { componentId: 'c-PF', amountPaisa: null, percent: 10 },
    { componentId: 'c-TAX', amountPaisa: 100_000, percent: null },
    { componentId: 'c-PF_EMPLOYER', amountPaisa: null, percent: 10 },
  ],
});
const NO_INPUT: PayrollInput = { lwpDays: 0, overtimeMinutes: 0, coverPeriods: 0, adjustments: [] };
const base = {
  period: periodOf('2091-11'), // 30 days
  staff: { joinedOn: '2090-01-01', leftOn: null },
  components: COMPONENTS,
  input: NO_INPUT,
  loans: [],
  occasionalCodes: ['FEST_BONUS'],
  includedCodes: [] as string[],
};
const line = (r: ReturnType<typeof computePayslip>, code: string) => r.lines.find((l) => l.code === code)?.amountPaisa;

describe('payroll calculator', () => {
  it('full month: basic + allowances - PF - tax; employer PF outside net; no bonus unless included', () => {
    const r = computePayslip({ ...base, contracts: [terms(3_000_000)] });
    expect(r).toMatchObject({
      workingDays: 30,
      paidDays: 30,
      grossPaisa: 4_700_000, // 30,000 + 15,000 + 2,000 Tk
      deductionsPaisa: 400_000, // PF 3,000 + TAX 1,000
      taxPaisa: 100_000,
      netPaisa: 4_300_000,
      employerContributionPaisa: 300_000,
    });
    expect(line(r, 'FEST_BONUS')).toBeUndefined();
    expect(r.lines.map((l) => l.code)).toEqual(['BASIC', 'HOUSE', 'MEDICAL', 'PF', 'TAX', 'PF_EMPLOYER']);
  });

  it('unpaid leave, overtime, cover periods and adjustments', () => {
    const r = computePayslip({
      ...base,
      contracts: [terms(3_000_000)],
      input: {
        lwpDays: 3,
        overtimeMinutes: 90,
        coverPeriods: 4,
        adjustments: [{ componentCode: 'OTHER_EARNING', amountPaisa: 50_000, note: 'Exam duty' }],
      },
    });
    expect(line(r, 'LWP')).toBe(470_000); // 47,000 / 30 x 3
    expect(line(r, 'OT')).toBe(30_000); // 1.5 h x 200
    expect(line(r, 'COVER_PAY')).toBe(120_000); // 4 x 300
    expect(r.lines.find((l) => l.code === 'OTHER_EARNING')).toMatchObject({ amountPaisa: 50_000, note: 'Exam duty' });
    expect(r.paidDays).toBe(27);
    expect(r.netPaisa).toBe(4_700_000 + 30_000 + 120_000 + 50_000 - 400_000 - 470_000);
  });

  it('joiner mid-month is pro-rated by calendar days', () => {
    const r = computePayslip({
      ...base,
      staff: { joinedOn: '2091-11-16', leftOn: null },
      contracts: [terms(3_000_000)],
    });
    expect(r.employedDays).toBe(15);
    expect(line(r, 'BASIC')).toBe(1_500_000);
    expect(r.grossPaisa).toBe(2_350_000);
  });

  it('salary revision mid-month: two segments; festival bonus once from the new basic', () => {
    const r = computePayslip({
      ...base,
      contracts: [terms(3_000_000, '2090-01-01', '2091-11-10'), terms(3_300_000, '2091-11-11')],
      includedCodes: ['FEST_BONUS'],
    });
    expect(line(r, 'BASIC')).toBe(3_200_000); // 30,000 x 10/30 + 33,000 x 20/30
    expect(line(r, 'FEST_BONUS')).toBe(3_300_000);
    expect(line(r, 'MEDICAL')).toBe(200_000);
  });

  it('loans come last and never push net pay below zero', () => {
    const small = computePayslip({
      ...base,
      contracts: [terms(3_000_000)],
      loans: [{ loanId: 'L1', kind: 'loan', installmentPaisa: 500_000, outstandingPaisa: 300_000 }],
    });
    expect(small.loanRecoveries).toEqual([{ loanId: 'L1', amountPaisa: 300_000 }]);
    expect(line(small, 'LOAN')).toBe(300_000);

    const huge = computePayslip({
      ...base,
      contracts: [terms(3_000_000)],
      loans: [
        { loanId: 'L1', kind: 'loan', installmentPaisa: 4_000_000, outstandingPaisa: 9_000_000 },
        { loanId: 'A1', kind: 'advance', installmentPaisa: 1_000_000, outstandingPaisa: 1_000_000 },
      ],
    });
    expect(huge.netPaisa).toBe(0);
    expect(huge.loanRecoveries).toEqual([
      { loanId: 'L1', amountPaisa: 4_000_000 },
      { loanId: 'A1', amountPaisa: 300_000 },
    ]);
    expect(huge.warnings.map((w) => w.code)).toContain('LOAN_REDUCED');
  });

  it('setup errors and unknown adjustment codes are refused', () => {
    expect(() => computePayslip({ ...base, contracts: [] })).toThrow(/No contract/);
    expect(() =>
      computePayslip({
        ...base,
        contracts: [terms(3_000_000)],
        input: { ...NO_INPUT, adjustments: [{ componentCode: 'NOPE', amountPaisa: 1 }] },
      }),
    ).toThrow(/Unknown salary component/);
    expect(() => periodOf('2091-13')).toThrow();
  });
});
