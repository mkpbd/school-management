import { InvariantError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';

/** Value of a line: quantity (up to 3 decimals) x unit price, rounded to whole paisa. */
export function lineAmount(quantity: number, unitPaisa: number): number {
  return Math.round(quantity * unitPaisa);
}

/** An annual amount spread evenly over 12 months; the remainder goes to the last month so the total is exact. */
export function spreadAnnual(annualPaisa: number): number[] {
  const base = Math.floor(annualPaisa / 12);
  const months = Array.from({ length: 12 }, () => base);
  months[11] = annualPaisa - base * 11;
  return months;
}

/** Calendar months (1-12) of the budget year that have started by `asOf` (inclusive of the asOf month). */
export function monthsElapsed(yearStart: string, yearEnd: string, asOf: string): number[] {
  const out: number[] = [];
  const last = LocalDate.parse(asOf).isAfter(LocalDate.parse(yearEnd)) ? yearEnd : asOf;
  let [y, m] = yearStart.split('-').map(Number) as [number, number];
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  if (LocalDate.parse(asOf).isBefore(LocalDate.parse(yearStart))) return out;
  while (y < ly || (y === ly && m <= lm)) {
    out.push(m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length === 12) break;
  }
  return out;
}

export const budgetKey = (accountId: string, costCentreId: string | null) => `${accountId}|${costCentreId ?? ''}`;

export interface BudgetPosition {
  budgetPaisa: number;
  actualPaisa: number;
  committedPaisa: number;
}

/** What is still free to spend: budget - actual - open commitments (never below zero for display). */
export function available(p: BudgetPosition): number {
  return p.budgetPaisa - p.actualPaisa - p.committedPaisa;
}

export interface Overrun {
  key: string;
  requestedPaisa: number;
  availablePaisa: number;
  overPaisa: number;
}

/**
 * Budget check for new spending grouped by account x cost centre. A line with no budget at all is an overrun of its
 * full amount (unbudgeted spending also needs the overrun approval).
 */
export function findOverruns(requested: Map<string, number>, positions: Map<string, BudgetPosition>): Overrun[] {
  const out: Overrun[] = [];
  for (const [key, amount] of requested) {
    const p = positions.get(key);
    const free = p ? available(p) : 0;
    if (amount > free)
      out.push({
        key,
        requestedPaisa: amount,
        availablePaisa: Math.max(free, 0),
        overPaisa: amount - Math.max(free, 0),
      });
  }
  return out;
}

export interface Withholding {
  vatPaisa: number;
  tdsPaisa: number;
  netPayablePaisa: number;
}

/**
 * VAT and income tax deducted at source from a supplier bill (rates configured per vendor by finance). The school
 * pays the vendor the net and deposits the withheld amounts with the government.
 */
export function withholding(grossPaisa: number, vatPct: number | null, tdsPct: number | null): Withholding {
  const vatPaisa = Math.round((grossPaisa * (vatPct ?? 0)) / 100);
  const tdsPaisa = Math.round((grossPaisa * (tdsPct ?? 0)) / 100);
  if (vatPaisa + tdsPaisa > grossPaisa)
    throw new InvariantError('WITHHOLDING_TOO_HIGH', 'VAT and TDS withheld exceed the bill amount');
  return { vatPaisa, tdsPaisa, netPayablePaisa: grossPaisa - vatPaisa - tdsPaisa };
}

/** Quotations needed before ordering: below the threshold one is enough. */
export function requiredQuotations(totalPaisa: number, thresholdPaisa: number, minimum: number): number {
  return totalPaisa >= thresholdPaisa ? Math.max(minimum, 1) : 1;
}

export interface QuoteForComparison {
  id: string;
  vendorId: string;
  totalPaisa: number;
  validUntil: string | null;
  deliveryDays: number | null;
}

/** Comparison sheet: valid quotes ranked by price (then delivery); expired ones listed last. */
export function rankQuotations<Q extends QuoteForComparison>(
  quotes: Q[],
  onDate: string,
): Array<Q & { rank: number | null; lowest: boolean; expired: boolean; aboveLowestPaisa: number | null }> {
  const valid = quotes.filter((q) => !q.validUntil || q.validUntil >= onDate);
  const sorted = [...valid].sort(
    (a, b) => a.totalPaisa - b.totalPaisa || (a.deliveryDays ?? 999) - (b.deliveryDays ?? 999),
  );
  const lowest = sorted[0]?.totalPaisa ?? null;
  const ranked = sorted.map((q, i) => ({
    ...q,
    rank: i + 1,
    lowest: q.totalPaisa === lowest,
    expired: false,
    aboveLowestPaisa: lowest === null ? null : q.totalPaisa - lowest,
  }));
  const expired = quotes
    .filter((q) => !valid.includes(q))
    .map((q) => ({ ...q, rank: null, lowest: false, expired: true, aboveLowestPaisa: null }));
  return [...ranked, ...expired];
}

/** Choosing a quotation: enough quotes (or a single-source reason), not expired, a reason if not the cheapest. */
export function assertSelectable(
  ranked: ReturnType<typeof rankQuotations>,
  quotationId: string,
  required: number,
  reason: string | undefined,
): void {
  const q = ranked.find((x) => x.id === quotationId);
  if (!q) throw new InvariantError('QUOTATION_NOT_FOUND', 'Quotation is not part of this requisition');
  if (q.expired) throw new InvariantError('QUOTATION_EXPIRED', 'The quotation is no longer valid');
  const valid = ranked.filter((x) => !x.expired).length;
  if (valid < required && !reason?.trim())
    throw new InvariantError(
      'QUOTATIONS_REQUIRED',
      `${required} valid quotations are required (have ${valid}); give a single-source reason to proceed`,
    );
  if (!q.lowest && !reason?.trim())
    throw new InvariantError('REASON_REQUIRED', 'Give a reason for not choosing the lowest quotation');
}

export interface PoLineState {
  id: string;
  quantity: number;
  receivedQty: number;
  billedQty: number;
  unitPaisa: number;
}

/** A receipt adds to what was received; never beyond the ordered quantity. */
export function applyReceipt(lines: PoLineState[], receipt: Array<{ poLineId: string; quantity: number }>) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const updated = new Map<string, number>();
  for (const r of receipt) {
    const l = byId.get(r.poLineId);
    if (!l) throw new InvariantError('PO_LINE_UNKNOWN', 'A line is not part of this purchase order');
    if (updated.has(r.poLineId)) throw new InvariantError('DUPLICATE_LINE', 'A line appears twice');
    if (r.quantity <= 0) throw new InvariantError('QUANTITY_INVALID', 'Quantity must be positive');
    const next = round3(l.receivedQty + r.quantity);
    if (next > l.quantity)
      throw new InvariantError('OVER_RECEIPT', `Receiving ${r.quantity} exceeds the ordered quantity (${l.quantity})`);
    updated.set(r.poLineId, next);
  }
  const fully = lines.every((l) => (updated.get(l.id) ?? l.receivedQty) >= l.quantity);
  return { receivedQty: updated, status: fully ? ('received' as const) : ('partially_received' as const) };
}

/** Three-way match: a bill covers only goods received and not yet billed; amounts from the PO price. */
export function matchBill(lines: PoLineState[], bill: Array<{ poLineId: string; quantity: number }>) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out = bill.map((b) => {
    const l = byId.get(b.poLineId);
    if (!l) throw new InvariantError('PO_LINE_UNKNOWN', 'A line is not part of this purchase order');
    if (seen.has(b.poLineId)) throw new InvariantError('DUPLICATE_LINE', 'A line appears twice');
    seen.add(b.poLineId);
    if (b.quantity <= 0) throw new InvariantError('QUANTITY_INVALID', 'Quantity must be positive');
    const open = round3(l.receivedQty - l.billedQty);
    if (b.quantity > open)
      throw new InvariantError(
        'NOT_RECEIVED',
        `Only ${open} received and not yet billed on a line; the bill asks for ${b.quantity}`,
      );
    return { poLineId: b.poLineId, quantity: b.quantity, amountPaisa: lineAmount(b.quantity, l.unitPaisa) };
  });
  return { lines: out, grossPaisa: out.reduce((s, l) => s + l.amountPaisa, 0) };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
