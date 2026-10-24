import { InvariantError } from '../../../shared/domain/errors.js';
import type { LocalDate } from '../../../shared/domain/LocalDate.js';

export type BorrowerType = 'student' | 'staff';
export type MemberType = 'student_junior' | 'student_senior' | 'teacher' | 'staff';
export type ReturnCondition = 'good' | 'damaged' | 'lost';
export type CopyStatus = 'available' | 'on_loan' | 'reserved' | 'lost' | 'damaged' | 'withdrawn' | 'in_repair';

/** Statuses a librarian may set by hand; on_loan / reserved only change through circulation. */
export const MANUAL_COPY_STATUSES = ['available', 'withdrawn', 'in_repair', 'damaged', 'lost'] as const;

export interface MemberPolicy {
  memberType: MemberType;
  maxLoans: number;
  loanDays: number;
  maxRenewals: number;
  finePerDayPaisa: number;
}

/**
 * Member type decides loan limits (lib.member_policy). Students from `seniorFromSeq` (year group order, default
 * Year 7) up are senior; teaching staff are teachers, everyone else on the staff list is staff.
 */
export function memberTypeOf(
  b: { type: 'student'; yearGroupSeq: number | null } | { type: 'staff'; staffType: string },
  seniorFromSeq: number,
): MemberType {
  if (b.type === 'staff') return b.staffType === 'teaching' ? 'teacher' : 'staff';
  return b.yearGroupSeq !== null && b.yearGroupSeq >= seniorFromSeq ? 'student_senior' : 'student_junior';
}

/** Calendar days late (0 when returned on or before the due date). */
export function overdueDays(dueOn: LocalDate, on: LocalDate): number {
  return Math.max(0, dueOn.daysUntil(on));
}

export interface FineInput {
  overdueDays: number;
  finePerDayPaisa: number;
  /** cap on the overdue part (core.setting lib.max_overdue_fine_paisa); null = no cap */
  overdueCapPaisa: number | null;
  condition: ReturnCondition;
  /** replacement cost for a lost copy: its price, else the configured default */
  replacementPaisa: number;
  /** assessed by the librarian for a damaged copy */
  damagePaisa: number;
}

export interface FineBreakdown {
  overduePaisa: number;
  replacementPaisa: number;
  damagePaisa: number;
  totalPaisa: number;
}

/** LIB-03 fine: overdue days x daily rate (capped) + replacement (lost) or assessed damage. */
export function assessFine(i: FineInput): FineBreakdown {
  if (i.damagePaisa < 0 || !Number.isSafeInteger(i.damagePaisa))
    throw new InvariantError('FINE_INVALID', 'Damage fine must be a non-negative number of paisa');
  let overdue = i.overdueDays * i.finePerDayPaisa;
  if (i.overdueCapPaisa !== null) overdue = Math.min(overdue, i.overdueCapPaisa);
  const replacement = i.condition === 'lost' ? i.replacementPaisa : 0;
  const damage = i.condition === 'damaged' ? i.damagePaisa : 0;
  return {
    overduePaisa: overdue,
    replacementPaisa: replacement,
    damagePaisa: damage,
    totalPaisa: overdue + replacement + damage,
  };
}

/** Copy status after a return; a good copy may go to the reservation queue instead (decided by the caller). */
export function copyStatusAfterReturn(condition: ReturnCondition): CopyStatus {
  return condition === 'lost' ? 'lost' : condition === 'damaged' ? 'damaged' : 'available';
}
