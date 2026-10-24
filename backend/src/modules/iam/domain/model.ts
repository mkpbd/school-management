/** IAM domain types (persistence-independent). */

export type AccountUserType = 'staff' | 'guardian' | 'student' | 'system';
export type SessionClient = 'web' | 'parent_app' | 'staff_app' | 'scanner';

export interface UserAccount {
  id: string;
  orgId: string;
  userType: AccountUserType;
  username: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  status: 'invited' | 'active' | 'locked' | 'disabled';
  mfaType: 'totp' | 'sms_otp' | null;
  mfaSecretEnc: Buffer | null;
  preferredLocale: 'en' | 'bn';
  failedLoginCount: number;
  lockedUntil: Date | null;
  authzVersion: number;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  client: SessionClient;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export interface OtpChallenge {
  id: string;
  userId: string | null;
  codeHash: Buffer;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * Lockout policy (docs/backend/cross-cutting.md §4.3): from the 10th consecutive failure the account is locked,
 * 15 minutes doubling per further failure, capped at 24 hours.
 */
export function lockedUntilAfterFailure(failedCount: number, now: Date): Date | null {
  if (failedCount < 10) return null;
  const minutes = Math.min(15 * 2 ** (failedCount - 10), 24 * 60);
  return new Date(now.getTime() + minutes * 60_000);
}

export const MAX_OTP_ATTEMPTS = 5;
export const OTP_TTL_MS = 5 * 60_000;
