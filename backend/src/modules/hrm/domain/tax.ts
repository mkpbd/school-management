import { InvariantError } from '../../../shared/domain/errors.js';

export type TaxCategory = 'general' | 'female' | 'senior' | 'disabled' | 'third_gender' | 'freedom_fighter';

/** Income-tax rules of one income year (hrm.tax_year.rules). All amounts in paisa. */
export interface TaxRules {
  /** tax-free income per category; categories not listed use `general` */
  thresholds: Partial<Record<TaxCategory, number>> & { general: number };
  /** slabs above the threshold, in order; `widthPaisa: null` = the rest */
  slabs: Array<{ widthPaisa: number | null; ratePct: number }>;
  /** salary exemption: the lower of `fraction` of salary and `capPaisa` */
  salaryExemption: { fraction: number; capPaisa: number };
  /** investment rebate: the lowest of incomePct of taxable income, investmentPct of investment, capPaisa */
  rebate: { incomePct: number; investmentPct: number; capPaisa: number };
  /** payable whenever taxable income exceeds the threshold */
  minimumTaxPaisa: number;
  /** lower minimum tax for a first-time taxpayer (Finance Act 2026: Tk 1,000) */
  newTaxpayerMinimumTaxPaisa?: number;
  /** added to the threshold per disabled child (one parent claims it) */
  disabledChildAllowancePaisa?: number;
}

/** Personal facts of one staff member for one income year. */
export interface TaxPersonal {
  category: TaxCategory;
  investmentPaisa: number;
  disabledChildren?: number;
  newTaxpayer?: boolean;
}

export interface AnnualTax {
  grossPaisa: number;
  exemptionPaisa: number;
  taxablePaisa: number;
  thresholdPaisa: number;
  slabTaxPaisa: number;
  rebatePaisa: number;
  minimumApplied: boolean;
  taxPaisa: number;
}

export function validateRules(r: TaxRules): void {
  const fail = (m: string) => {
    throw new InvariantError('TAX_RULES_INVALID', m);
  };
  if (!(r.thresholds?.general >= 0)) fail('thresholds.general is required');
  if (!r.slabs?.length) fail('at least one slab is required');
  r.slabs.forEach((s, i) => {
    if (!(s.ratePct >= 0 && s.ratePct <= 100)) fail(`slab ${i + 1}: ratePct 0-100`);
    if (s.widthPaisa === null && i !== r.slabs.length - 1) fail('only the last slab may be open-ended');
    if (s.widthPaisa !== null && !(s.widthPaisa > 0)) fail(`slab ${i + 1}: widthPaisa must be positive`);
  });
  if (r.slabs.at(-1)!.widthPaisa !== null) fail('the last slab must be open-ended (widthPaisa: null)');
  if (!(r.salaryExemption.fraction >= 0 && r.salaryExemption.fraction <= 1)) fail('salaryExemption.fraction 0-1');
}

/** Annual tax on salary income (Bangladesh individual rules shape: exemption -> slabs -> rebate -> minimum). */
export function annualTax(i: TaxPersonal & { grossPaisa: number }, r: TaxRules): AnnualTax {
  const gross = Math.max(0, i.grossPaisa);
  const exemption = Math.min(Math.round(gross * r.salaryExemption.fraction), r.salaryExemption.capPaisa);
  const taxable = gross - exemption;
  const threshold =
    (r.thresholds[i.category] ?? r.thresholds.general) +
    Math.max(0, i.disabledChildren ?? 0) * (r.disabledChildAllowancePaisa ?? 0);
  let remaining = Math.max(0, taxable - threshold);
  let slabTax = 0;
  for (const s of r.slabs) {
    if (remaining <= 0) break;
    const part = s.widthPaisa === null ? remaining : Math.min(remaining, s.widthPaisa);
    slabTax += (part * s.ratePct) / 100;
    remaining -= part;
  }
  slabTax = Math.round(slabTax);
  const rebate = Math.round(
    Math.min(
      (taxable * r.rebate.incomePct) / 100,
      (Math.max(0, i.investmentPaisa) * r.rebate.investmentPct) / 100,
      r.rebate.capPaisa,
    ),
  );
  let tax = Math.max(0, slabTax - rebate);
  let minimumApplied = false;
  const minimum =
    i.newTaxpayer && r.newTaxpayerMinimumTaxPaisa !== undefined ? r.newTaxpayerMinimumTaxPaisa : r.minimumTaxPaisa;
  if (taxable > threshold && tax < minimum) {
    tax = minimum;
    minimumApplied = true;
  }
  return {
    grossPaisa: gross,
    exemptionPaisa: exemption,
    taxablePaisa: taxable,
    thresholdPaisa: threshold,
    slabTaxPaisa: slabTax,
    rebatePaisa: Math.min(rebate, slabTax),
    minimumApplied,
    taxPaisa: tax,
  };
}

export interface TdsContext extends TaxPersonal {
  rules: TaxRules;
  /** taxable salary and tax deducted in earlier locked months of the income year */
  ytdTaxablePaisa: number;
  ytdTaxPaisa: number;
  /** months of the income year after this one */
  monthsAfterThis: number;
}

/**
 * Monthly TDS: projected annual salary = year-to-date + this month + regular monthly salary for the rest of the
 * year; this month deducts (annual tax - already deducted) / months left including this one.
 */
export function monthlyTds(
  t: TdsContext,
  thisMonthTaxablePaisa: number,
  regularMonthlyTaxablePaisa: number,
): { tdsPaisa: number; projectedAnnual: AnnualTax } {
  const projected = annualTax(
    {
      grossPaisa: t.ytdTaxablePaisa + thisMonthTaxablePaisa + regularMonthlyTaxablePaisa * t.monthsAfterThis,
      category: t.category,
      investmentPaisa: t.investmentPaisa,
      disabledChildren: t.disabledChildren ?? 0,
      newTaxpayer: t.newTaxpayer ?? false,
    },
    t.rules,
  );
  const due = Math.max(0, projected.taxPaisa - t.ytdTaxPaisa);
  return { tdsPaisa: Math.round(due / (t.monthsAfterThis + 1)), projectedAnnual: projected };
}

/** Months of the income year after `periodStart`'s month (income year ends on `yearEnd`). */
export function monthsAfter(periodStart: string, yearEnd: string): number {
  const [y1, m1] = periodStart.split('-').map(Number) as [number, number];
  const [y2, m2] = yearEnd.split('-').map(Number) as [number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}
