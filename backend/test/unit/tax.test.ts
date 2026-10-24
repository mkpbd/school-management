import { describe, expect, it } from 'vitest';
import { computePayslip, periodOf, type SalaryComponent } from '../../src/modules/hrm/domain/payroll.js';
import { annualTax, monthlyTds, monthsAfter, validateRules, type TaxRules } from '../../src/modules/hrm/domain/tax.js';

const TK = 100; // paisa
// shape of the seeded 2026-27 table (amounts as reported for the Finance Act; tests only need the mechanics)
const RULES: TaxRules = {
  thresholds: { general: 400_000 * TK, female: 450_000 * TK, senior: 450_000 * TK, disabled: 525_000 * TK },
  slabs: [
    { widthPaisa: 300_000 * TK, ratePct: 10 },
    { widthPaisa: 400_000 * TK, ratePct: 15 },
    { widthPaisa: 500_000 * TK, ratePct: 20 },
    { widthPaisa: 2_000_000 * TK, ratePct: 25 },
    { widthPaisa: null, ratePct: 30 },
  ],
  salaryExemption: { fraction: 1 / 3, capPaisa: 450_000 * TK },
  rebate: { incomePct: 3, investmentPct: 15, capPaisa: 1_000_000 * TK },
  minimumTaxPaisa: 5_000 * TK,
};

describe('income tax (salary)', () => {
  it('exemption, slabs, investment rebate', () => {
    const r = annualTax({ grossPaisa: 900_000 * TK, category: 'general', investmentPaisa: 50_000 * TK }, RULES);
    expect(r).toMatchObject({
      exemptionPaisa: 300_000 * TK, // a third of 9 lakh (below the 4.5 lakh cap)
      taxablePaisa: 600_000 * TK,
      slabTaxPaisa: 20_000 * TK, // 2 lakh above the threshold at 10 %
      rebatePaisa: 7_500 * TK, // 15 % of 50,000 (less than 3 % of income)
      taxPaisa: 12_500 * TK,
      minimumApplied: false,
    });
  });

  it('high income walks every slab; exemption capped', () => {
    const r = annualTax({ grossPaisa: 6_000_000 * TK, category: 'general', investmentPaisa: 0 }, RULES);
    // taxable 55.5 lakh: 3 lakh x10 % + 4 x15 % + 5 x20 % + 20 x25 % + 19.5 x30 %
    expect(r.exemptionPaisa).toBe(450_000 * TK);
    expect(r.slabTaxPaisa).toBe((30_000 + 60_000 + 100_000 + 500_000 + 585_000) * TK);
  });

  it('thresholds by category and the minimum tax', () => {
    const woman = annualTax({ grossPaisa: 660_000 * TK, category: 'female', investmentPaisa: 0 }, RULES);
    expect(woman.taxPaisa).toBe(0); // taxable 4.4 lakh < 4.5 lakh
    const small = annualTax({ grossPaisa: 615_000 * TK, category: 'general', investmentPaisa: 0 }, RULES);
    // taxable 4.1 lakh: 1,000 by slab, raised to the 5,000 minimum
    expect(small).toMatchObject({ slabTaxPaisa: 1_000 * TK, taxPaisa: 5_000 * TK, minimumApplied: true });
  });

  it('monthly TDS spreads the remaining annual tax over the months left', () => {
    const july = monthlyTds(
      {
        rules: RULES,
        category: 'general',
        investmentPaisa: 50_000 * TK,
        ytdTaxablePaisa: 0,
        ytdTaxPaisa: 0,
        monthsAfterThis: 11,
      },
      75_000 * TK,
      75_000 * TK,
    );
    expect(july.projectedAnnual.taxPaisa).toBe(12_500 * TK);
    expect(july.tdsPaisa).toBe(104_167); // 12,500 / 12
    // after a raise in January the remaining tax is spread over the last 6 months
    const jan = monthlyTds(
      {
        rules: RULES,
        category: 'general',
        investmentPaisa: 50_000 * TK,
        ytdTaxablePaisa: 6 * 75_000 * TK,
        ytdTaxPaisa: 6 * 104_167,
        monthsAfterThis: 5,
      },
      90_000 * TK,
      90_000 * TK,
    );
    // projected 4.5 + 5.4 lakh = 9.9 lakh: exemption 3.3, taxable 6.6 lakh, tax 26,000 - rebate 7,500 = 18,500
    expect(jan.projectedAnnual.taxPaisa).toBe(18_500 * TK);
    expect(jan.tdsPaisa).toBe(Math.round((18_500 * TK - 6 * 104_167) / 6));
    expect(monthsAfter('2026-07-01', '2027-06-30')).toBe(11);
    expect(monthsAfter('2027-06-01', '2027-06-30')).toBe(0);
  });

  it('rules validation', () => {
    expect(() => validateRules({ ...RULES, slabs: [{ widthPaisa: 1, ratePct: 10 }] })).toThrow(/open-ended/);
    expect(() => validateRules(RULES)).not.toThrow();
  });

  it('payslip: automatic TDS before loans; a contract TAX amount wins', () => {
    const comp = (code: string, kind: SalaryComponent['kind'], calc: SalaryComponent['calc'], taxable = true) => ({
      id: `c-${code}`,
      code,
      nameEn: code,
      kind,
      calc,
      seq: 0,
      taxable,
    });
    const components = [
      comp('BASIC', 'earning', 'fixed'),
      comp('HOUSE', 'earning', 'percent_of_basic'),
      comp('TAX', 'deduction', 'fixed', false),
      comp('LWP', 'deduction', 'per_unit', false),
    ];
    const contract = (tax?: number) => ({
      contractId: 'k',
      startsOn: '2026-01-01',
      endsOn: null,
      basicPaisa: 50_000 * TK,
      components: [
        { componentId: 'c-HOUSE', amountPaisa: null, percent: 50 },
        ...(tax ? [{ componentId: 'c-TAX', amountPaisa: tax, percent: null }] : []),
      ],
    });
    const base = {
      period: periodOf('2026-07'),
      staff: { joinedOn: '2026-01-01', leftOn: null },
      components,
      input: { lwpDays: 0, overtimeMinutes: 0, coverPeriods: 0, adjustments: [] },
      loans: [],
      occasionalCodes: [],
      includedCodes: [],
      tds: {
        rules: RULES,
        category: 'general' as const,
        investmentPaisa: 0,
        ytdTaxablePaisa: 0,
        ytdTaxPaisa: 0,
        monthsAfterThis: 11,
      },
    };
    const auto = computePayslip({ ...base, contracts: [contract()] });
    // 75,000 / month -> 9 lakh a year, no investment: 20,000 a year
    expect(auto.taxablePaisa).toBe(75_000 * TK);
    expect(auto.tax.mode).toBe('auto');
    expect(auto.taxPaisa).toBe(Math.round((20_000 * TK) / 12));
    const fixed = computePayslip({ ...base, contracts: [contract(3_000 * TK)] });
    expect(fixed.tax.mode).toBe('contract');
    expect(fixed.taxPaisa).toBe(3_000 * TK);
  });
});

describe('Finance Act 2026 personal facts', () => {
  const act: TaxRules = {
    thresholds: { general: 40_000_000 },
    slabs: [
      { widthPaisa: 30_000_000, ratePct: 10 },
      { widthPaisa: null, ratePct: 15 },
    ],
    salaryExemption: { fraction: 0, capPaisa: 0 },
    rebate: { incomePct: 0, investmentPct: 0, capPaisa: 0 },
    minimumTaxPaisa: 500_000,
    newTaxpayerMinimumTaxPaisa: 100_000,
    disabledChildAllowancePaisa: 5_000_000,
  };

  it('each disabled child raises the tax-free threshold', () => {
    const base = annualTax({ grossPaisa: 50_000_000, category: 'general', investmentPaisa: 0 }, act);
    const two = annualTax(
      { grossPaisa: 50_000_000, category: 'general', investmentPaisa: 0, disabledChildren: 2 },
      act,
    );
    expect(base.thresholdPaisa).toBe(40_000_000);
    expect(base.slabTaxPaisa).toBe(1_000_000);
    expect(two.thresholdPaisa).toBe(50_000_000);
    expect(two.taxPaisa).toBe(0);
  });

  it('a first-time taxpayer pays the lower minimum tax', () => {
    const small = { grossPaisa: 40_100_000, category: 'general' as const, investmentPaisa: 0 };
    expect(annualTax(small, act)).toMatchObject({ slabTaxPaisa: 10_000, minimumApplied: true, taxPaisa: 500_000 });
    expect(annualTax({ ...small, newTaxpayer: true }, act)).toMatchObject({ taxPaisa: 100_000, minimumApplied: true });
  });
});
