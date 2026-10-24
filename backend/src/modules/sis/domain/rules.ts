import { InvariantError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';

export interface GuardianLinkInput {
  relationship:
    'father' | 'mother' | 'grandfather' | 'grandmother' | 'uncle' | 'aunt' | 'sibling' | 'legal_guardian' | 'other';
  isPrimaryContact?: boolean;
  isFeePayer?: boolean;
  canPickup?: boolean;
}

/**
 * Exactly one primary contact (receives absence SMS) and at least one fee payer (SIS-02).
 * If none is flagged, the first guardian becomes both.
 */
export function normaliseGuardianFlags<T extends GuardianLinkInput>(
  guardians: T[],
): Array<T & Required<GuardianLinkInput>> {
  if (!guardians.length) throw new InvariantError('GUARDIAN_REQUIRED', 'At least one guardian is required');
  const primaries = guardians.filter((g) => g.isPrimaryContact).length;
  if (primaries > 1)
    throw new InvariantError('PRIMARY_CONTACT_MULTIPLE', 'Only one guardian can be the primary contact');
  const payers = guardians.filter((g) => g.isFeePayer).length;
  return guardians.map((g, i) => ({
    ...g,
    isPrimaryContact: primaries === 0 ? i === 0 : !!g.isPrimaryContact,
    isFeePayer: payers === 0 ? (primaries === 0 ? i === 0 : !!g.isPrimaryContact) : !!g.isFeePayer,
    canPickup: g.canPickup ?? true,
  }));
}

/** Date of birth must be in the past and give a plausible school age (2-25 years) on the admission date. */
export function assertPlausibleDob(dob: string, admittedOn: string): void {
  const birth = LocalDate.parse(dob);
  const admitted = LocalDate.parse(admittedOn);
  const years = birth.daysUntil(admitted) / 365.25;
  if (years < 2 || years > 25)
    throw new InvariantError('DOB_IMPLAUSIBLE', 'Date of birth gives an implausible age for admission');
}

/** Next roll number in a section: max + 1 (gaps from withdrawals are not re-used mid-year). */
export function nextRollNo(existing: Array<number | null>): number {
  return existing.reduce<number>((max, r) => (r !== null && r > max ? r : max), 0) + 1;
}
