import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import { InvariantError } from '../../../shared/domain/errors.js';
import type { PasswordHasher } from '../../../shared/infrastructure/crypto/PasswordHasher.js';
import { passwordPolicyErrors } from '../../../shared/infrastructure/crypto/PasswordHasher.js';
import { role, roleAssignment, userAccount } from '../../../shared/infrastructure/db/schema/iam.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { IamModuleApi, UserContact } from '../public-api/IamModuleApi.js';

/** Runs in the caller's transaction. Role changes bump authz_version (cached grants become unreachable). */
export class IamModuleApiImpl implements IamModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; ctx: RequestContext; passwordHasher: PasswordHasher }) {}

  contacts(userIds: string[]): Promise<Map<string, UserContact>> {
    return this.d.uow.run(
      async () => {
        if (!userIds.length) return new Map<string, UserContact>();
        const rows = await this.d.uow
          .tx()
          .select({
            userId: userAccount.id,
            userType: userAccount.userType,
            phone: userAccount.phone,
            email: userAccount.email,
            locale: userAccount.preferredLocale,
          })
          .from(userAccount)
          .where(
            and(
              inArray(userAccount.id, userIds),
              inArray(userAccount.status, ['active', 'invited']),
              isNull(userAccount.deletedAt),
            ),
          );
        return new Map(rows.map((r) => [r.userId, r as UserContact]));
      },
      { readOnly: !this.d.uow.isActive() },
    );
  }

  usersWithRole(roleId: string, campusId?: string | null): Promise<string[]> {
    return this.d.uow.run(
      async () => {
        const rows = await this.d.uow
          .tx()
          .selectDistinct({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(
            and(
              eq(roleAssignment.roleId, roleId),
              campusId ? or(isNull(roleAssignment.campusId), eq(roleAssignment.campusId, campusId)) : undefined,
            ),
          );
        return rows.map((r) => r.userId);
      },
      { readOnly: !this.d.uow.isActive() },
    );
  }

  createStaffAccount(input: Parameters<IamModuleApi['createStaffAccount']>[0]): Promise<{ userId: string }> {
    return this.d.uow.run(async () => {
      const problems = passwordPolicyErrors(input.password);
      if (problems.length) throw new InvariantError('PASSWORD_WEAK', `Password must have ${problems.join(', ')}`);
      const passwordHash = await this.d.passwordHasher.hash(input.password);
      const [user] = await this.d.uow
        .tx()
        .insert(userAccount)
        .values({
          orgId: this.d.ctx.orgId,
          userType: 'staff',
          username: input.username,
          email: input.email ?? null,
          passwordHash,
          status: 'active',
          preferredLocale: input.locale ?? 'en',
        })
        .returning({ id: userAccount.id });
      await this.assignRole(user!.id, input.roleCode, input.campusId ?? null);
      return { userId: user!.id };
    });
  }

  ensureGuardianAccount(input: { phone: string; locale?: 'en' | 'bn' }): Promise<{ userId: string; created: boolean }> {
    return this.d.uow.run(async () => {
      const tx = this.d.uow.tx();
      const [existing] = await tx
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(
          and(eq(userAccount.phone, input.phone), eq(userAccount.userType, 'guardian'), isNull(userAccount.deletedAt)),
        );
      if (existing) return { userId: existing.id, created: false };
      const [user] = await tx
        .insert(userAccount)
        .values({
          orgId: this.d.ctx.orgId,
          userType: 'guardian',
          phone: input.phone,
          status: 'active',
          preferredLocale: input.locale ?? 'bn',
        })
        .returning({ id: userAccount.id });
      await this.assignRole(user!.id, 'PARENT', null);
      return { userId: user!.id, created: true };
    });
  }

  assignRole(userId: string, roleCode: string, campusId?: string | null): Promise<void> {
    return this.d.uow.run(async () => {
      const tx = this.d.uow.tx();
      const [r] = await tx.select({ id: role.id }).from(role).where(eq(role.code, roleCode));
      if (!r) throw new InvariantError('ROLE_UNKNOWN', `Unknown role ${roleCode}`);
      await tx
        .insert(roleAssignment)
        .values({
          orgId: this.d.ctx.orgId,
          userId,
          roleId: r.id,
          scopeType: campusId ? 'campus' : 'org',
          campusId: campusId ?? null,
          grantedBy: this.d.ctx.userId,
        })
        .onConflictDoNothing();
      await tx
        .update(userAccount)
        .set({ authzVersion: sql`${userAccount.authzVersion} + 1` })
        .where(eq(userAccount.id, userId));
    });
  }

  disableAccount(userId: string): Promise<void> {
    return this.d.uow.run(async () => {
      await this.d.uow
        .tx()
        .update(userAccount)
        .set({ status: 'disabled', authzVersion: sql`${userAccount.authzVersion} + 1` })
        .where(eq(userAccount.id, userId));
    });
  }
}
