import { ConflictError, InvariantError } from '../../../shared/domain/errors.js';

export type HostelGender = 'boys' | 'girls' | 'mixed';
export type RoomType = 'single' | 'double' | 'triple' | 'quad' | 'dormitory';
export type RollStatus = 'present' | 'absent' | 'late' | 'on_leave';
export type OutpassStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'out' | 'returned';

/** A boys' hostel takes male students, a girls' hostel female students; mixed takes both. */
export function assertGenderAllowed(hostel: HostelGender, studentGender: string): void {
  const ok =
    hostel === 'mixed' ||
    (hostel === 'boys' && studentGender === 'male') ||
    (hostel === 'girls' && studentGender === 'female');
  if (!ok) throw new InvariantError('HOSTEL_GENDER', `A ${hostel} hostel cannot take this student`);
}

/** Default bed labels for a new room (a dormitory needs an explicit count). */
export function defaultBeds(type: RoomType, count?: number): string[] {
  const n = count ?? { single: 1, double: 2, triple: 3, quad: 4, dormitory: 0 }[type];
  if (!n) throw new InvariantError('BED_COUNT_REQUIRED', 'Give the number of beds for a dormitory');
  if (n > 60) throw new InvariantError('BED_COUNT_INVALID', 'At most 60 beds per room');
  // A..Z, then 27, 28 ... for large dormitories
  return Array.from({ length: n }, (_, i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1)));
}

/** Gate check-out: only an approved pass, from `earlyMinutes` before its start until its return time. */
export function assertCanCheckOut(
  p: { status: OutpassStatus; outFrom: Date; returnBy: Date },
  now: Date,
  earlyMinutes: number,
): void {
  if (p.status !== 'approved') throw new ConflictError('OUTPASS_NOT_APPROVED', `Out-pass is ${p.status}`);
  if (now.getTime() < p.outFrom.getTime() - earlyMinutes * 60_000)
    throw new ConflictError('OUTPASS_TOO_EARLY', 'The out-pass starts later');
  if (now >= p.returnBy) throw new ConflictError('OUTPASS_EXPIRED', 'The out-pass has already expired');
}

/** Minutes late on return (0 when back in time). */
export function minutesLate(returnBy: Date, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - returnBy.getTime()) / 60_000));
}
