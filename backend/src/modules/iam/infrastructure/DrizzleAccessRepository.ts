import { and, asc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { DataScope } from '../../../shared/application/RequestContext.js';
import {
  permission,
  role,
  roleAssignment,
  rolePermission,
  userAccount,
} from '../../../shared/infrastructure/db/schema/iam.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AccessRepository, AssignmentRow, RoleRow, UserRow } from '../application/AccessControlUseCases.js';

const roleCols = {
  id: role.id,
  code: role.code,
  nameEn: role.nameEn,
  nameBn: role.nameBn,
  isSystem: role.isSystem,
  requiresMfa: role.requiresMfa,
};
const userCols = {
  id: userAccount.id,
  userType: userAccount.userType,
  username: userAccount.username,
  email: userAccount.email,
  phone: userAccount.phone,
  status: userAccount.status,
  lastLoginAt: userAccount.lastLoginAt,
};
const assignmentCols = {
  id: roleAssignment.id,
  userId: roleAssignment.userId,
  roleId: roleAssignment.roleId,
  roleCode: role.code,
  roleName: role.nameEn,
  scopeType: roleAssignment.scopeType,
  campusId: roleAssignment.campusId,
  validFrom: roleAssignment.validFrom,
  validTo: roleAssignment.validTo,
  grantedBy: roleAssignment.grantedBy,
};

const activeOn = (onDate: string): SQL =>
  and(lte(roleAssignment.validFrom, onDate), or(isNull(roleAssignment.validTo), gte(roleAssignment.validTo, onDate)))!;

/** Roles, permissions and assignments. role_permission has no tenant column: it is reached through iam.role (RLS). */
export class DrizzleAccessRepository implements AccessRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async permissions() {
    return this.tx
      .select({
        code: permission.code,
        module: permission.module,
        resource: permission.resource,
        action: permission.action,
        isSensitive: permission.isSensitive,
        description: permission.description,
      })
      .from(permission)
      .orderBy(asc(permission.module), asc(permission.resource), asc(permission.action));
  }

  async roles() {
    const rows = await this.tx
      .select({
        ...roleCols,
        permissionCount: sql<number>`(SELECT count(*) FROM iam.role_permission rp WHERE rp.role_id = ${sql.identifier('iam')}.${sql.identifier('role')}.${sql.identifier('id')})::int`,
        userCount: sql<number>`(SELECT count(DISTINCT ra.user_id) FROM iam.role_assignment ra WHERE ra.role_id = ${sql.identifier('iam')}.${sql.identifier('role')}.${sql.identifier('id')} AND ra.valid_from <= current_date AND (ra.valid_to IS NULL OR ra.valid_to >= current_date))::int`,
      })
      .from(role)
      .orderBy(asc(role.code));
    return rows;
  }

  async role(id: string): Promise<RoleRow | null> {
    const [r] = await this.tx.select(roleCols).from(role).where(eq(role.id, id));
    return r ?? null;
  }

  async roleByCode(code: string): Promise<RoleRow | null> {
    const [r] = await this.tx.select(roleCols).from(role).where(eq(role.code, code));
    return r ?? null;
  }

  async rolePermissions(roleId: string) {
    const rows = await this.tx
      .select({ code: rolePermission.permissionCode, scope: rolePermission.dataScope })
      .from(rolePermission)
      .innerJoin(role, eq(role.id, rolePermission.roleId))
      .where(eq(rolePermission.roleId, roleId))
      .orderBy(asc(rolePermission.permissionCode));
    return rows.map((r) => ({ code: r.code, scope: r.scope as DataScope }));
  }

  async allRolePermissions() {
    const rows = await this.tx
      .select({ roleId: rolePermission.roleId, code: rolePermission.permissionCode, scope: rolePermission.dataScope })
      .from(rolePermission)
      .innerJoin(role, eq(role.id, rolePermission.roleId));
    return rows.map((r) => ({ ...r, scope: r.scope as DataScope }));
  }

  async insertRole(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(role)
      .values(values as typeof role.$inferInsert)
      .returning({ id: role.id });
    return r!.id;
  }

  async updateRole(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(role).set(patch).where(eq(role.id, id));
  }

  async deleteRole(id: string): Promise<void> {
    await this.tx.delete(role).where(eq(role.id, id)); // role_permission cascades
  }

  async replaceRolePermissions(roleId: string, rows: Array<{ code: string; scope: DataScope }>): Promise<void> {
    await this.tx.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
    if (rows.length)
      await this.tx
        .insert(rolePermission)
        .values(rows.map((r) => ({ roleId, permissionCode: r.code, dataScope: r.scope })));
  }

  async roleHolders(roleId: string, onDate: string): Promise<string[]> {
    const rows = await this.tx
      .selectDistinct({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.roleId, roleId), activeOn(onDate)));
    return rows.map((r) => r.userId);
  }

  async permissionHolders(code: string, onDate: string, except: { roleId?: string; assignmentId?: string } = {}) {
    const rows = await this.tx
      .selectDistinct({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .innerJoin(rolePermission, eq(rolePermission.roleId, roleAssignment.roleId))
      .innerJoin(userAccount, eq(userAccount.id, roleAssignment.userId))
      .where(
        and(
          eq(rolePermission.permissionCode, code),
          activeOn(onDate),
          eq(userAccount.status, 'active'),
          isNull(userAccount.deletedAt),
          except.roleId ? ne(roleAssignment.roleId, except.roleId) : undefined,
          except.assignmentId ? ne(roleAssignment.id, except.assignmentId) : undefined,
        ),
      );
    return rows.map((r) => r.userId);
  }

  async users(f: {
    q?: string;
    userType?: string;
    roleId?: string;
    campusId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<UserRow[]> {
    const where: SQL[] = [isNull(userAccount.deletedAt), ne(userAccount.userType, 'system')];
    if (f.q) {
      const like = `%${f.q}%`;
      where.push(
        or(ilike(userAccount.username, like), ilike(userAccount.email, like), ilike(userAccount.phone, like))!,
      );
    }
    if (f.userType) where.push(eq(userAccount.userType, f.userType as UserRow['userType']));
    if (f.status) where.push(eq(userAccount.status, f.status as never));
    if (f.roleId || f.campusId) {
      const sub = this.tx
        .select({ id: roleAssignment.userId })
        .from(roleAssignment)
        .where(
          and(
            f.roleId ? eq(roleAssignment.roleId, f.roleId) : undefined,
            f.campusId ? eq(roleAssignment.campusId, f.campusId) : undefined,
          ),
        );
      where.push(inArray(userAccount.id, sub));
    }
    const rows = await this.tx
      .select(userCols)
      .from(userAccount)
      .where(and(...where))
      .orderBy(asc(userAccount.userType), asc(userAccount.username), asc(userAccount.phone))
      .limit(f.limit)
      .offset(f.offset);
    return rows as UserRow[];
  }

  async user(id: string): Promise<UserRow | null> {
    const [r] = await this.tx
      .select(userCols)
      .from(userAccount)
      .where(and(eq(userAccount.id, id), isNull(userAccount.deletedAt)));
    return (r as UserRow | undefined) ?? null;
  }

  async assignments(userId: string): Promise<AssignmentRow[]> {
    return this.tx
      .select(assignmentCols)
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(eq(roleAssignment.userId, userId))
      .orderBy(asc(role.code));
  }

  async assignment(id: string): Promise<AssignmentRow | null> {
    const [r] = await this.tx
      .select(assignmentCols)
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(eq(roleAssignment.id, id));
    return r ?? null;
  }

  async insertAssignment(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(roleAssignment)
      .values(values as typeof roleAssignment.$inferInsert)
      .returning({ id: roleAssignment.id });
    return r!.id;
  }

  async deleteAssignment(id: string): Promise<void> {
    await this.tx.delete(roleAssignment).where(eq(roleAssignment.id, id));
  }

  async setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
    await this.tx.update(userAccount).set({ status }).where(eq(userAccount.id, userId));
  }

  async bumpAuthz(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.tx
      .update(userAccount)
      .set({ authzVersion: sql`${userAccount.authzVersion} + 1` })
      .where(inArray(userAccount.id, userIds));
  }
}
