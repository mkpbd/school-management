import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  DEFAULT_PAYROLL_ACCOUNTS,
  naturalBalance,
  payrollJournal,
} from '../../src/modules/acc/domain/journal.js';

describe('double entry', () => {
  it('balanced, one side per line, whole paisa', () => {
    expect(
      assertBalanced([
        { accountCode: '1100', debitPaisa: 500, creditPaisa: 0 },
        { accountCode: '3100', debitPaisa: 0, creditPaisa: 500 },
      ]).totalPaisa,
    ).toBe(500);
    expect(() =>
      assertBalanced([
        { accountCode: '1100', debitPaisa: 500, creditPaisa: 0 },
        { accountCode: '3100', debitPaisa: 0, creditPaisa: 400 },
      ]),
    ).toThrow(/differ/);
    expect(() =>
      assertBalanced([
        { accountCode: '1100', debitPaisa: 5, creditPaisa: 5 },
        { accountCode: '3100', debitPaisa: 0, creditPaisa: 0 },
      ]),
    ).toThrow(/exactly one/);
  });

  it('salary journal of a payroll: expenses, deductions to liabilities, net to payable, LWP nets the expense', () => {
    const lines = payrollJournal(
      [
        { code: 'BASIC', kind: 'earning', amountPaisa: 4_000_000 },
        { code: 'HOUSE', kind: 'earning', amountPaisa: 2_000_000 },
        { code: 'MEDICAL', kind: 'earning', amountPaisa: 200_000 },
        { code: 'OT', kind: 'earning', amountPaisa: 40_000 },
        { code: 'FEST_BONUS', kind: 'earning', amountPaisa: 3_000_000 },
        { code: 'PF', kind: 'deduction', amountPaisa: 300_000 },
        { code: 'TAX', kind: 'deduction', amountPaisa: 100_000 },
        { code: 'LWP', kind: 'deduction', amountPaisa: 156_667 },
        { code: 'LOAN', kind: 'deduction', amountPaisa: 250_000 },
        { code: 'PF_EMPLOYER', kind: 'employer_contribution', amountPaisa: 300_000 },
      ],
      DEFAULT_PAYROLL_ACCOUNTS,
    );
    const by = Object.fromEntries(lines.map((l) => [l.accountCode, l.debitPaisa || -l.creditPaisa]));
    expect(by).toEqual({
      '5100': 6_043_333, // basic + house + medical - unpaid leave
      '5120': 3_000_000,
      '5130': 40_000,
      '5110': 300_000,
      '2110': -600_000, // employee + employer PF
      '2120': -100_000,
      '1210': -250_000,
      '2100': -8_433_333, // net pay
    });
    expect(assertBalanced(lines).totalPaisa).toBe(9_383_333);
  });

  it('natural balance direction', () => {
    expect(naturalBalance('asset', 100, 30)).toBe(70);
    expect(naturalBalance('liability', 100, 30)).toBe(-70);
    expect(naturalBalance('income', 0, 50)).toBe(50);
  });
});
