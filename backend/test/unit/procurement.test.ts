import { describe, expect, it } from 'vitest';
import {
  applyReceipt,
  assertSelectable,
  findOverruns,
  lineAmount,
  matchBill,
  monthsElapsed,
  rankQuotations,
  requiredQuotations,
  spreadAnnual,
  withholding,
} from '../../src/modules/acc/domain/procurement.js';

describe('budget arithmetic', () => {
  it('spreads an annual amount over 12 months exactly', () => {
    const m = spreadAnnual(100_000_01);
    expect(m).toHaveLength(12);
    expect(m.reduce((s, x) => s + x, 0)).toBe(100_000_01);
    expect(m[0]).toBe(833_333);
    expect(m[11]).toBe(100_000_01 - 833_333 * 11);
  });

  it('months elapsed across a year that starts mid-calendar', () => {
    expect(monthsElapsed('2092-07-01', '2093-06-30', '2092-09-15')).toEqual([7, 8, 9]);
    expect(monthsElapsed('2092-07-01', '2093-06-30', '2093-02-01')).toEqual([7, 8, 9, 10, 11, 12, 1, 2]);
    expect(monthsElapsed('2092-07-01', '2093-06-30', '2094-01-01')).toHaveLength(12);
    expect(monthsElapsed('2092-07-01', '2093-06-30', '2092-06-30')).toEqual([]);
  });

  it('overruns: beyond budget - actual - committed, and unbudgeted lines', () => {
    const positions = new Map([['a|cc', { budgetPaisa: 100_000, actualPaisa: 30_000, committedPaisa: 20_000 }]]);
    expect(findOverruns(new Map([['a|cc', 50_000]]), positions)).toEqual([]);
    expect(findOverruns(new Map([['a|cc', 60_000]]), positions)).toEqual([
      { key: 'a|cc', requestedPaisa: 60_000, availablePaisa: 50_000, overPaisa: 10_000 },
    ]);
    expect(findOverruns(new Map([['b|', 1]]), positions)[0]).toMatchObject({ availablePaisa: 0, overPaisa: 1 });
  });
});

describe('quotations', () => {
  const quotes = [
    { id: 'q1', vendorId: 'v1', totalPaisa: 120_000, validUntil: '2092-12-31', deliveryDays: 5 },
    { id: 'q2', vendorId: 'v2', totalPaisa: 100_000, validUntil: '2092-12-31', deliveryDays: 10 },
    { id: 'q3', vendorId: 'v3', totalPaisa: 90_000, validUntil: '2092-01-01', deliveryDays: 1 },
  ];

  it('ranks valid quotes by price; expired listed last', () => {
    const r = rankQuotations(quotes, '2092-03-01');
    expect(r.map((q) => [q.id, q.rank, q.lowest, q.expired])).toEqual([
      ['q2', 1, true, false],
      ['q1', 2, false, false],
      ['q3', null, false, true],
    ]);
    expect(r[1]!.aboveLowestPaisa).toBe(20_000);
  });

  it('threshold decides how many quotes; non-lowest and too few need a reason', () => {
    expect(requiredQuotations(2_000_000, 2_500_000, 3)).toBe(1);
    expect(requiredQuotations(2_500_000, 2_500_000, 3)).toBe(3);
    const r = rankQuotations(quotes, '2092-03-01');
    expect(() => assertSelectable(r, 'q2', 3, undefined)).toThrow(
      expect.objectContaining({ code: 'QUOTATIONS_REQUIRED' }),
    );
    expect(() => assertSelectable(r, 'q2', 2, undefined)).not.toThrow();
    expect(() => assertSelectable(r, 'q1', 2, undefined)).toThrow(expect.objectContaining({ code: 'REASON_REQUIRED' }));
    expect(() => assertSelectable(r, 'q1', 2, 'Faster delivery, local warranty')).not.toThrow();
    expect(() => assertSelectable(r, 'q3', 1, 'x')).toThrow(expect.objectContaining({ code: 'QUOTATION_EXPIRED' }));
  });
});

describe('receipt, three-way match, withholding', () => {
  const lines = [
    { id: 'l1', quantity: 10, receivedQty: 0, billedQty: 0, unitPaisa: 15_050 },
    { id: 'l2', quantity: 2.5, receivedQty: 0, billedQty: 0, unitPaisa: 40_000 },
  ];

  it('partial then full receipt; never beyond the order', () => {
    const first = applyReceipt(lines, [{ poLineId: 'l1', quantity: 6 }]);
    expect(first.status).toBe('partially_received');
    expect(() => applyReceipt(lines, [{ poLineId: 'l1', quantity: 10.5 }])).toThrow(
      expect.objectContaining({ code: 'OVER_RECEIPT' }),
    );
    const all = applyReceipt(lines, [
      { poLineId: 'l1', quantity: 10 },
      { poLineId: 'l2', quantity: 2.5 },
    ]);
    expect(all.status).toBe('received');
  });

  it('bills only what was received and not yet billed, at the PO price', () => {
    const received = [
      { ...lines[0]!, receivedQty: 6, billedQty: 2 },
      { ...lines[1]!, receivedQty: 2.5 },
    ];
    const m = matchBill(received, [
      { poLineId: 'l1', quantity: 4 },
      { poLineId: 'l2', quantity: 2.5 },
    ]);
    expect(m.grossPaisa).toBe(4 * 15_050 + lineAmount(2.5, 40_000));
    expect(() => matchBill(received, [{ poLineId: 'l1', quantity: 4.001 }])).toThrow(
      expect.objectContaining({ code: 'NOT_RECEIVED' }),
    );
  });

  it('VAT and TDS withheld at source; the vendor gets the net', () => {
    expect(withholding(1_000_000, 7.5, 5)).toEqual({ vatPaisa: 75_000, tdsPaisa: 50_000, netPayablePaisa: 875_000 });
    expect(withholding(999, null, 2.5)).toEqual({ vatPaisa: 0, tdsPaisa: 25, netPayablePaisa: 974 });
  });
});
