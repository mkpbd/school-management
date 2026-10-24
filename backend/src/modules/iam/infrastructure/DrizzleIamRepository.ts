import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  otpChallenge,
  refreshToken,
  role,
  roleAssignment,
  userAccount,
} from '../../../shared/infrastructure/db/schema/iam.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { OtpChallenge, RefreshTokenRecord, SessionClient, UserAccount } from '../domain/model.js';
import type { IamRepository } from '../domain/repositories.js';

const userColumns = {
  id: userAccount.id,
  orgId: userAccount.orgId,
  userType: userAccount.userType,
  username: userAccount.username,
  email: userAccount.email,
  phone: userAccount.phone,
  passwordHash: userAccount.passwordHash,
  status: userAccount.status,
  mfaType: userAccount.mfaType,
  mfaSecretEnc: userAccount.mfaSecretEnc,
  preferredLocale: userAccount.preferredLocale,
  failedLoginCount: userAccount.failedLoginCount,
  lockedUntil: userAccount.lockedUntil,
  authzVersion: userAccount.authzVersion,
};

/** Drizzle implementation of IamRepository. All queries run inside the request's UnitOfWork (RLS applies). */
export class DrizzleIamRepository implements IamRepository {
  private readonly uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.uow = deps.uow;
  }

  private get tx() {
    return this.uow.tx();
  }

  async findForLogin(identifier: string): Promise<UserAccount | null> {
    const [row] = await this.tx
      .select(userColumns)
      .from(userAccount)
      .where(
        and(
          isNull(userAccount.deletedAt),
          inArray(userAccount.userType, ['staff', 'student']),
          or(eq(userAccount.username, identifier), eq(userAccount.email, identifier)),
        ),
      )
      .limit(1);
    return (row as UserAccount | undefined) ?? null;
  }

  async findById(userId: string): Promise<UserAccount | null> {
    const [row] = await this.tx
      .select(userColumns)
      .from(userAccount)
      .where(and(eq(userAccount.id, userId), isNull(userAccount.deletedAt)));
    return (row as UserAccount | undefined) ?? null;
  }

  async findActiveGuardianByPhone(phone: string): Promise<UserAccount | null> {
    const [row] = await this.tx
      .select(userColumns)
      .from(userAccount)
      .where(
        and(
          eq(userAccount.phone, phone),
          eq(userAccount.userType, 'guardian'),
          eq(userAccount.status, 'active'),
          isNull(userAccount.deletedAt),
        ),
      )
      .limit(1);
    return (row as UserAccount | undefined) ?? null;
  }

  async recordFailedLogin(userId: string): Promise<{ failedCount: number }> {
    const [row] = await this.tx
      .update(userAccount)
      .set({ failedLoginCount: sql`${userAccount.failedLoginCount} + 1` })
      .where(eq(userAccount.id, userId))
      .returning({ failedCount: userAccount.failedLoginCount });
    return { failedCount: row?.failedCount ?? 0 };
  }

  async setLockedUntil(userId: string, until: Date | null): Promise<void> {
    await this.tx.update(userAccount).set({ lockedUntil: until }).where(eq(userAccount.id, userId));
  }

  async recordSuccessfulLogin(userId: string, now: Date): Promise<void> {
    await this.tx
      .update(userAccount)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(userAccount.id, userId));
  }

  async hasRoleRequiringMfa(userId: string): Promise<boolean> {
    const rows = await this.tx
      .select({ id: role.id })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(and(eq(roleAssignment.userId, userId), eq(role.requiresMfa, true)))
      .limit(1);
    return rows.length > 0;
  }

  async insertRefreshToken(t: Parameters<IamRepository['insertRefreshToken']>[0]): Promise<void> {
    await this.tx.insert(refreshToken).values({
      userId: t.userId,
      familyId: t.familyId,
      tokenHash: t.tokenHash,
      client: t.client,
      expiresAt: t.expiresAt,
      ip: t.ip ?? null,
      userAgent: t.userAgent?.slice(0, 500) ?? null,
    });
  }

  async findRefreshTokenForUpdate(tokenHash: Buffer): Promise<RefreshTokenRecord | null> {
    const [row] = await this.tx
      .select({
        id: refreshToken.id,
        userId: refreshToken.userId,
        familyId: refreshToken.familyId,
        client: refreshToken.client,
        expiresAt: refreshToken.expiresAt,
        rotatedAt: refreshToken.rotatedAt,
        revokedAt: refreshToken.revokedAt,
      })
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, tokenHash))
      .for('update');
    return row ? { ...row, client: row.client as SessionClient } : null;
  }

  async markRotated(id: string, now: Date): Promise<void> {
    await this.tx.update(refreshToken).set({ rotatedAt: now }).where(eq(refreshToken.id, id));
  }

  async revokeFamily(familyId: string, reason: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(refreshToken)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(refreshToken.familyId, familyId), isNull(refreshToken.revokedAt)))
      .returning({ id: refreshToken.id });
    return rows.length;
  }

  async insertOtp(o: Parameters<IamRepository['insertOtp']>[0]): Promise<void> {
    await this.tx.insert(otpChallenge).values({
      id: o.id,
      phone: o.phone,
      userId: o.userId,
      purpose: o.purpose,
      codeHash: o.codeHash,
      expiresAt: o.expiresAt,
    });
  }

  async latestOpenOtpForUpdate(phone: string, purpose: 'login', now: Date): Promise<OtpChallenge | null> {
    const [row] = await this.tx
      .select({
        id: otpChallenge.id,
        userId: otpChallenge.userId,
        codeHash: otpChallenge.codeHash,
        attempts: otpChallenge.attempts,
        expiresAt: otpChallenge.expiresAt,
        consumedAt: otpChallenge.consumedAt,
      })
      .from(otpChallenge)
      .where(
        and(
          eq(otpChallenge.phone, phone),
          eq(otpChallenge.purpose, purpose),
          isNull(otpChallenge.consumedAt),
          gt(otpChallenge.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenge.createdAt))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.tx
      .update(otpChallenge)
      .set({ attempts: sql`${otpChallenge.attempts} + 1` })
      .where(eq(otpChallenge.id, id));
  }

  async consumeOtp(id: string, now: Date): Promise<void> {
    await this.tx.update(otpChallenge).set({ consumedAt: now }).where(eq(otpChallenge.id, id));
  }
}
