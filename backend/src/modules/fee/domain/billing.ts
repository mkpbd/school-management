import { InvariantError } from '../../../shared/domain/errors.js';
import { Money } from '../../../shared/domain/Money.js';

export interface FeeLineSource {
  feeHeadId: string;
  headName: string;
  amountPaisa: number;
  /** month numbers of the academic year (1 = first month); null = one-time charge */
  billingMonths: number[] | null;
  appliesTo: 'all' | 'new_admission' | 'continuing';
  priority: number;
  isDiscountable: boolean;
  source: 'structure' | 'student_item';
  sourceRef: string;
}

export interface ConcessionSource {
  id: string;
  /** heads the concession applies to (type default heads, or the specific head) */
  feeHeadIds: string[];
  calc: 'percent' | 'amount';
  valuePercent: number | null;
  valuePaisa: number | null;
  stacking: 'best_of' | 'additive' | 'exclusive';
  maxPercentCap: number | null;
}

export interface BuiltLine {
  feeHeadId: string;
  description: string;
  amountPaisa: number;
  discountPaisa: number;
  concessionId: string | null;
  source: 'structure' | 'student_item';
  sourceRef: string;
  priority: number;
}

/**
 * Month number (1..12) of `period` (YYYY-MM) inside an academic year starting on `yearStartsOn` (YYYY-MM-DD).
 * Example: year starts 2026-07-01, period 2026-11 -> 5.
 */
export function academicMonthIndex(yearStartsOn: string, period: string): number {
  const [sy, sm] = yearStartsOn.split('-').map(Number) as [number, number];
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new InvariantError('PERIOD_INVALID', 'Billing period must be YYYY-MM');
  const idx = (Number(m[1]) - sy) * 12 + (Number(m[2]) - sm) + 1;
  if (idx < 1 || idx > 12)
    throw new InvariantError('PERIOD_OUTSIDE_YEAR', `Period ${period} is outside the academic year`);
  return idx;
}

/** Discount for one line from all applicable concessions, respecting stacking and the percent cap. */
export function discountFor(
  line: { feeHeadId: string; amountPaisa: number },
  concessions: ConcessionSource[],
): { discountPaisa: number; concessionId: string | null } {
  const applicable = concessions.filter((c) => c.feeHeadIds.includes(line.feeHeadId));
  if (!applicable.length || line.amountPaisa <= 0) return { discountPaisa: 0, concessionId: null };
  const amount = Money.ofPaisa(line.amountPaisa);
  const valueOf = (c: ConcessionSource) =>
    c.calc === 'percent' ? amount.percent(c.valuePercent ?? 0).paisa : Math.min(c.valuePaisa ?? 0, line.amountPaisa);

  const exclusive = applicable.filter((c) => c.stacking === 'exclusive');
  const pool = exclusive.length ? exclusive : applicable;
  const additive = pool.filter((c) => c.stacking === 'additive');
  const best = pool.filter((c) => c.stacking !== 'additive').sort((a, b) => valueOf(b) - valueOf(a))[0];
  let discount = (best ? valueOf(best) : 0) + additive.reduce((s, c) => s + valueOf(c), 0);
  const caps = pool.map((c) => c.maxPercentCap).filter((x): x is number => x !== null);
  if (caps.length) discount = Math.min(discount, amount.percent(Math.min(...caps)).paisa);
  discount = Math.min(discount, line.amountPaisa);
  return { discountPaisa: discount, concessionId: best?.id ?? additive[0]?.id ?? null };
}

/**
 * Builds invoice lines for one billing month (FEE-01/02/03): structure lines due this month (+ one-time lines on the
 * first bill), student fee items, then concessions on discountable heads.
 */
export function buildInvoiceLines(i: {
  sources: FeeLineSource[];
  concessions: ConcessionSource[];
  monthIndex: number;
  isNewAdmission: boolean;
  isFirstInvoiceOfYear: boolean;
  periodLabel: string;
}): BuiltLine[] {
  const due = i.sources.filter((s) => {
    if (s.appliesTo === 'new_admission' && !i.isNewAdmission) return false;
    if (s.appliesTo === 'continuing' && i.isNewAdmission) return false;
    return s.billingMonths === null ? i.isFirstInvoiceOfYear : s.billingMonths.includes(i.monthIndex);
  });
  return due
    .filter((s) => s.amountPaisa > 0)
    .map((s) => {
      const { discountPaisa, concessionId } = s.isDiscountable
        ? discountFor(s, i.concessions)
        : { discountPaisa: 0, concessionId: null };
      return {
        feeHeadId: s.feeHeadId,
        description: s.billingMonths === null ? s.headName : `${s.headName} ${i.periodLabel}`,
        amountPaisa: s.amountPaisa,
        discountPaisa,
        concessionId,
        source: s.source,
        sourceRef: s.sourceRef,
        priority: s.priority,
      };
    });
}

export interface OpenLine {
  invoiceId: string;
  invoiceLineId: string;
  dueDate: string;
  priority: number;
  outstandingPaisa: number;
}

/**
 * FEE-05 allocation policy: oldest due date first, then head priority (fines and arrears before tuition).
 * Returns the allocations and the unallocated remainder (kept as family credit).
 */
export function allocatePayment(
  amountPaisa: number,
  lines: OpenLine[],
): { allocations: Array<{ invoiceId: string; invoiceLineId: string; amountPaisa: number }>; remainderPaisa: number } {
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0)
    throw new InvariantError('AMOUNT_INVALID', 'Amount must be a positive number of paisa');
  let remaining = amountPaisa;
  const allocations: Array<{ invoiceId: string; invoiceLineId: string; amountPaisa: number }> = [];
  const ordered = [...lines].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) || a.priority - b.priority || a.invoiceLineId.localeCompare(b.invoiceLineId),
  );
  for (const l of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, l.outstandingPaisa);
    if (take > 0) {
      allocations.push({ invoiceId: l.invoiceId, invoiceLineId: l.invoiceLineId, amountPaisa: take });
      remaining -= take;
    }
  }
  return { allocations, remainderPaisa: remaining };
}
