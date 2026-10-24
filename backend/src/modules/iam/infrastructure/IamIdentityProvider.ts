import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { AccessClaims, AuthenticatedIdentity, IdentityProvider } from '../../../shared/application/auth.js';
import type { Cache } from '../../../shared/application/ports.js';
import {
  systemContext,
  type Grants,
  type ScopeGrant,
  type DataScope,
} from '../../../shared/application/RequestContext.js';
import { AuthError } from '../../../shared/domain/errors.js';
import { CacheKeys } from '../../../shared/infrastructure/cache/cache.js';
import type { Database } from '../../../shared/infrastructure/db/client.js';
import { staff } from '../../../shared/infrastructure/db/schema/hrm.js';
import { roleAssignment, rolePermission, userAccount } from '../../../shared/infrastructure/db/schema/iam.js';
// Identity linking reads the user_id link columns of hrm.staff / sis.guardian / sis.student directly.
// When SIS and HRM modules exist, replace with their public APIs (personLinksForUser).
import { guardian, student } from '../../../shared/infrastructure/db/schema/sis.js';
import { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';

interface CachedIdentity {
  grants: Grants;
  staffId?: string;
  guardianId?: string;
  studentId?: string;
}

interface UserState {
  status: string;
  authzVersion: number;
  locale: 'en' | 'bn';
  userType: AuthenticatedIdentity['userType'];
}

/**
 * Resolves token claims into identity + grants (docs/backend/cross-cutting.md §5.1).
 * - `authz:{user}:{version}` grants are cached 10 min; bumping iam.user_account.authz_version makes old entries
 *   unreachable and old access tokens invalid (claims.av !== current version) => instant revocation.
 * - the current version is cached for 30 s (`authzv:{user}`), deleted by IAM when it bumps the version.
 * Runs in its own system-context transaction (identity lookup must see staff/guardian rows on every campus).
 */
export class IamIdentityProvider implements IdentityProvider {
  private readonly db: Database;
  private readonly cache: Cache;
  private readonly orgId: string;

  constructor(deps: { db: Database; cache: Cache; orgId: string }) {
    this.db = deps.db;
    this.cache = deps.cache;
    this.orgId = deps.orgId;
  }

  async resolve(claims: AccessClaims): Promise<AuthenticatedIdentity> {
    const state = await this.cache.wrap(`authzv:${claims.sub}`, 30, () => this.loadState(claims.sub));
    if (!state || state.status !== 'active') throw new AuthError('ACCOUNT_DISABLED', 'Account is not active');
    if (state.authzVersion !== claims.av)
      throw new AuthError('TOKEN_REVOKED', 'Session was revoked; please sign in again');

    const cached = await this.cache.wrap(CacheKeys.grants(claims.sub, claims.av), 600, () =>
      this.loadIdentity(claims.sub),
    );
    return {
      userId: claims.sub,
      orgId: this.orgId,
      userType: state.userType,
      locale: state.locale,
      grants: cached.grants,
      staffId: cached.staffId,
      guardianId: cached.guardianId,
      studentId: cached.studentId,
    };
  }

  /** Called after role/password changes (together with bumping authz_version). */
  async invalidate(userId: string): Promise<void> {
    await this.cache.del(`authzv:${userId}`);
  }

  private uow(): UnitOfWork {
    return new UnitOfWork({ db: this.db, replicaDb: this.db, ctx: systemContext(this.orgId, 'identity') });
  }

  private loadState(userId: string): Promise<UserState | null> {
    const uow = this.uow();
    return uow.run(async () => {
      const [row] = await uow
        .tx()
        .select({
          status: userAccount.status,
          authzVersion: userAccount.authzVersion,
          locale: userAccount.preferredLocale,
          userType: userAccount.userType,
        })
        .from(userAccount)
        .where(and(eq(userAccount.id, userId), isNull(userAccount.deletedAt)));
      return row ? ({ ...row } as UserState) : null;
    });
  }

  private loadIdentity(userId: string): Promise<CachedIdentity> {
    const uow = this.uow();
    return uow.run(async () => {
      const tx = uow.tx();
      const today = sql`current_date`;
      const rows = await tx
        .select({
          permission: rolePermission.permissionCode,
          scope: rolePermission.dataScope,
          scopeType: roleAssignment.scopeType,
          campusId: roleAssignment.campusId,
        })
        .from(roleAssignment)
        .innerJoin(rolePermission, eq(rolePermission.roleId, roleAssignment.roleId))
        .where(
          and(
            eq(roleAssignment.userId, userId),
            lte(roleAssignment.validFrom, today),
            or(isNull(roleAssignment.validTo), gte(roleAssignment.validTo, today)),
          ),
        );

      const byPermission: Record<string, ScopeGrant[]> = {};
      const campuses = new Set<string>();
      let orgWide = false;
      for (const r of rows) {
        if (r.scopeType === 'org') orgWide = true;
        else if (r.campusId) campuses.add(r.campusId);
        const grant: ScopeGrant = { scope: r.scope as DataScope, campusId: r.scopeType === 'org' ? null : r.campusId };
        const list = (byPermission[r.permission] ??= []);
        if (!list.some((g) => g.scope === grant.scope && g.campusId === grant.campusId)) list.push(grant);
      }

      const [s] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId)).limit(1);
      const [g] = await tx.select({ id: guardian.id }).from(guardian).where(eq(guardian.userId, userId)).limit(1);
      const [st] = await tx.select({ id: student.id }).from(student).where(eq(student.userId, userId)).limit(1);
      return {
        grants: { campusIds: orgWide ? '*' : [...campuses], byPermission },
        ...(s ? { staffId: s.id } : {}),
        ...(g ? { guardianId: g.id } : {}),
        ...(st ? { studentId: st.id } : {}),
      };
    });
  }
}
