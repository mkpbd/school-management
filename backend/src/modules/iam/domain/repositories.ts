import type { OtpChallenge, RefreshTokenRecord, SessionClient, UserAccount } from './model.js';

/** Persistence port for the IAM module (implemented with Drizzle in infrastructure/). */
export interface IamRepository {
  findForLogin(identifier: string): Promise<UserAccount | null>;
  findById(userId: string): Promise<UserAccount | null>;
  findActiveGuardianByPhone(phone: string): Promise<UserAccount | null>;
  recordFailedLogin(userId: string, now: Date): Promise<{ failedCount: number }>;
  setLockedUntil(userId: string, until: Date | null): Promise<void>;
  recordSuccessfulLogin(userId: string, now: Date): Promise<void>;
  hasRoleRequiringMfa(userId: string): Promise<boolean>;

  insertRefreshToken(t: {
    userId: string;
    familyId: string;
    tokenHash: Buffer;
    client: SessionClient;
    expiresAt: Date;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void>;
  findRefreshTokenForUpdate(tokenHash: Buffer): Promise<RefreshTokenRecord | null>;
  markRotated(id: string, now: Date): Promise<void>;
  revokeFamily(familyId: string, reason: string, now: Date): Promise<number>;

  insertOtp(o: {
    id: string;
    phone: string;
    userId: string | null;
    purpose: 'login';
    codeHash: Buffer;
    expiresAt: Date;
  }): Promise<void>;
  latestOpenOtpForUpdate(phone: string, purpose: 'login', now: Date): Promise<OtpChallenge | null>;
  incrementOtpAttempts(id: string): Promise<void>;
  consumeOtp(id: string, now: Date): Promise<void>;
}
