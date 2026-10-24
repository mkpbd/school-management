import { InvariantError } from '../../../shared/domain/errors.js';

export type MovementType =
  | 'receipt'
  | 'issue'
  | 'transfer_out'
  | 'transfer_in'
  | 'sale'
  | 'sale_return'
  | 'adjustment'
  | 'write_off'
  | 'opening';

const OUTWARD: ReadonlySet<MovementType> = new Set(['issue', 'transfer_out', 'sale', 'write_off']);

/** Quantities are positive with at most 3 decimals (kg, litres, metres). */
export function assertQuantity(qty: number): void {
  if (!(qty > 0) || Math.round(qty * 1000) !== qty * 1000)
    throw new InvariantError('QUANTITY_INVALID', 'Quantity must be positive with at most 3 decimals');
}

/** Signed change of a movement; adjustments carry their own sign. */
export function signedDelta(type: MovementType, qty: number): number {
  if (type === 'adjustment') return qty;
  return OUTWARD.has(type) ? -Math.abs(qty) : Math.abs(qty);
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** No negative stock (I-9): an outward movement may take at most what is on hand. */
export function assertAvailable(onHand: number, delta: number, label: string): void {
  if (round3(onHand + delta) < 0)
    throw new InvariantError('INSUFFICIENT_STOCK', `Only ${onHand} of ${label} on hand; ${-delta} requested`);
}

/** Stock count: the adjustment that brings the book quantity to what was counted (0 = nothing to post). */
export function countAdjustment(onHand: number, counted: number): number {
  if (counted < 0 || Math.round(counted * 1000) !== counted * 1000)
    throw new InvariantError('QUANTITY_INVALID', 'Counted quantity must be zero or positive with at most 3 decimals');
  return round3(counted - onHand);
}

/** Weighted average cost after a receipt (paisa per unit, whole paisa). */
export function averageCost(onHand: number, avg: number, qtyIn: number, unitCost: number): number {
  const total = onHand + qtyIn;
  return total > 0 ? Math.round((onHand * avg + qtyIn * unitCost) / total) : avg;
}

export function isLow(onHand: number, minQty: number | null): boolean {
  return minQty !== null && minQty > 0 && onHand <= minQty;
}
