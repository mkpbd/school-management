import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { DataScope, RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';

/** The permission that administers access; at least one active holder must always remain. */
export const ADMIN_PERMISSION = 'iam.role.edit';

export type UserType = 'staff' | 'guardian' | 'student' | 'system';

export interface PermissionRow {
  code: string;
  module: string;
  resource: string;
  action: string;
  isSensitive: boolean;
  description: string | null;
}

export interface RoleRow {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  isSystem: boolean;
  requiresMfa: boolean;
}

export interface AssignmentRow {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: 'org' | 'campus';
  campusId: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
}

export interface UserRow {
  id: string;
  userType: UserType;
  username: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  lastLoginAt: Date | null;
}

export interface AccessRepository {
  permissions(): Promise<PermissionRow[]>;
  roles(): Promise<Array<RoleRow & { permissionCount: number; userCount: number }>>;
  role(id: string): Promise<RoleRow | null>;
  roleByCode(code: string): Promise<RoleRow | null>;
  rolePermissions(roleId: string): Promise<Array<{ code: string; scope: DataScope }>>;
  allRolePermissions(): Promise<Array<{ roleId: string; code: string; scope: DataScope }>>;
  insertRole(values: Record<string, unknown>): Promise<string>;
  updateRole(id: string, patch: Record<string, unknown>): Promise<void>;
  deleteRole(id: string): Promise<void>;
  replaceRolePermissions(roleId: string, rows: Array<{ code: string; scope: DataScope }>): Promise<void>;
  /** user ids holding the role today (assignment valid) */
  roleHolders(roleId: string, onDate: string): Promise<string[]>;
  /** active holders of a permission (any role), optionally ignoring one role or one assignment */
  permissionHolders(
    code: string,
    onDate: string,
    except?: { roleId?: string; assignmentId?: string },
  ): Promise<string[]>;
  users(f: {
    q?: string;
    userType?: string;
    roleId?: string;
    campusId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<UserRow[]>;
  user(id: string): Promise<UserRow | null>;
  assignments(userId: string): Promise<AssignmentRow[]>;
  assignment(id: string): Promise<AssignmentRow | null>;
  insertAssignment(values: Record<string, unknown>): Promise<string>;
  deleteAssignment(id: string): Promise<void>;
  setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void>;
  bumpAuthz(userIds: string[]): Promise<void>;
}

/** Clears cached grants so a change applies on the user's next request (token version mismatch -> refresh). */
export interface GrantCache {
  invalidate(userId: string): Promise<void>;
}

interface Deps {
  uow: TransactionRunner & { afterCommit(fn: () => Promise<unknown> | void): void };
  ctx: RequestContext;
  clock: Clock;
  accessRepo: AccessRepository;
  scopePolicy: ScopePolicy;
  identityProvider: GrantCache;
}

const ROLE_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

/** Which kind of account a role is for: parent / student roles are not for staff and vice versa. */
export function userTypeForRole(code: string): UserType {
  return code === 'PARENT' ? 'guardian' : code === 'STUDENT' ? 'student' : 'staff';
}

async function bumpAndInvalidate(d: Deps, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  await d.accessRepo.bumpAuthz(userIds);
  d.uow.afterCommit(async () => {
    for (const u of userIds) await d.identityProvider.invalidate(u);
  });
}

async function holdsRole(d: Deps, roleId: string): Promise<boolean> {
  const today = LocalDate.today(d.clock).iso;
  return !!d.ctx.userId && (await d.accessRepo.roleHolders(roleId, today)).includes(d.ctx.userId);
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue and roles
// ---------------------------------------------------------------------------------------------------------------

export interface PermissionGroup {
  module: string;
  resources: Array<{ resource: string; actions: Array<{ code: string; action: string; isSensitive: boolean }> }>;
}

export class ListPermissions extends Query<Record<string, never>, PermissionGroup[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle() {
    const out = new Map<string, Map<string, PermissionGroup['resources'][number]['actions']>>();
    for (const p of await this.d.accessRepo.permissions()) {
      const mod = out.get(p.module) ?? out.set(p.module, new Map()).get(p.module)!;
      const res = mod.get(p.resource) ?? mod.set(p.resource, []).get(p.resource)!;
      res.push({ code: p.code, action: p.action, isSensitive: p.isSensitive });
    }
    return [...out.entries()].map(([module, resources]) => ({
      module,
      resources: [...resources.entries()].map(([resource, actions]) => ({ resource, actions })),
    }));
  }
}

export class ListRoles extends Query<
  Record<string, never>,
  Array<RoleRow & { permissionCount: number; userCount: number }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.accessRepo.roles();
  }
}

export class GetRole extends Query<
  { id: string },
  RoleRow & { permissions: Array<{ code: string; scope: DataScope }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.accessRepo.role(id);
    if (!r) throw new NotFoundError();
    return { ...r, permissions: await this.d.accessRepo.rolePermissions(id) };
  }
}

/** Grid for the permission screen: roles x permissions with the data scope in each granted cell. */
export class RoleMatrix extends Query<
  { module?: string },
  { roles: RoleRow[]; permissions: PermissionRow[]; cells: Record<string, Record<string, DataScope>> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { module?: string }) {
    const permissions = (await this.d.accessRepo.permissions()).filter((p) => !i.module || p.module === i.module);
    const wanted = new Set(permissions.map((p) => p.code));
    const roles = (await this.d.accessRepo.roles()).map(({ permissionCount: _p, userCount: _u, ...r }) => r);
    const codeOf = new Map(roles.map((r) => [r.id, r.code]));
    const cells: Record<string, Record<string, DataScope>> = {};
    for (const rp of await this.d.accessRepo.allRolePermissions()) {
      if (!wanted.has(rp.code)) continue;
      const role = codeOf.get(rp.roleId)!;
      (cells[role] ??= {})[rp.code] = rp.scope;
    }
    return { roles, permissions, cells };
  }
}

export class CreateRole extends UseCase<
  { code: string; nameEn: string; nameBn?: string; requiresMfa?: boolean; copyFromRoleId?: string },
  RoleRow & { permissions: Array<{ code: string; scope: DataScope }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    code: string;
    nameEn: string;
    nameBn?: string;
    requiresMfa?: boolean;
    copyFromRoleId?: string;
  }) {
    if (!ROLE_CODE.test(i.code))
      throw new InvariantError('ROLE_CODE_INVALID', 'Role code: capitals, digits, underscore');
    if (await this.d.accessRepo.roleByCode(i.code)) throw new ConflictError('ROLE_EXISTS', `Role ${i.code} exists`);
    const copy = i.copyFromRoleId ? await this.d.accessRepo.rolePermissions(i.copyFromRoleId) : [];
    if (i.copyFromRoleId && !(await this.d.accessRepo.role(i.copyFromRoleId)))
      throw new NotFoundError('Role to copy not found');
    const id = await this.d.accessRepo.insertRole({
      orgId: this.d.ctx.orgId,
      code: i.code,
      nameEn: i.nameEn,
      nameBn: i.nameBn ?? null,
      isSystem: false,
      requiresMfa: !!i.requiresMfa,
    });
    if (copy.length) await this.d.accessRepo.replaceRolePermissions(id, copy);
    return { ...(await this.d.accessRepo.role(id))!, permissions: copy };
  }
}

export class UpdateRole extends UseCase<
  { id: string; nameEn?: string; nameBn?: string | null; requiresMfa?: boolean },
  RoleRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; nameEn?: string; nameBn?: string | null; requiresMfa?: boolean }) {
    const r = await this.d.accessRepo.role(i.id);
    if (!r) throw new NotFoundError();
    const { id, ...patch } = i;
    await this.d.accessRepo.updateRole(id, patch);
    if (i.requiresMfa !== undefined && i.requiresMfa !== r.requiresMfa)
      await bumpAndInvalidate(this.d, await this.d.accessRepo.roleHolders(id, LocalDate.today(this.d.clock).iso));
    return (await this.d.accessRepo.role(id))!;
  }
}

export interface PermissionChange {
  role: RoleRow;
  added: string[];
  removed: string[];
  rescoped: string[];
  sensitiveAdded: string[];
  usersAffected: number;
}

/**
 * Replaces the permissions of a role (module x action x data scope). Guards: nobody edits a role they hold
 * (no self-escalation); access administration can never disappear entirely (LAST_ADMIN). Holders' cached grants are
 * invalidated, so the change applies on their next request. role_permission is audited.
 */
export class SetRolePermissions extends UseCase<
  { id: string; permissions: Array<{ code: string; scope: DataScope }> },
  PermissionChange
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; permissions: Array<{ code: string; scope: DataScope }> }) {
    const { d } = this;
    const r = await d.accessRepo.role(i.id);
    if (!r) throw new NotFoundError();
    if (await holdsRole(d, r.id)) throw new ForbiddenError('SELF_ROLE_EDIT', 'You cannot change a role you hold');
    const catalogue = new Map((await d.accessRepo.permissions()).map((p) => [p.code, p]));
    const next = new Map<string, DataScope>();
    for (const p of i.permissions) {
      if (!catalogue.has(p.code)) throw new InvariantError('PERMISSION_UNKNOWN', `Unknown permission ${p.code}`);
      if (next.has(p.code)) throw new InvariantError('PERMISSION_REPEATED', `${p.code} appears twice`);
      next.set(p.code, p.scope);
    }
    const before = new Map((await d.accessRepo.rolePermissions(r.id)).map((p) => [p.code, p.scope]));
    const today = LocalDate.today(d.clock).iso;
    if (before.has(ADMIN_PERMISSION) && !next.has(ADMIN_PERMISSION)) {
      const others = await d.accessRepo.permissionHolders(ADMIN_PERMISSION, today, { roleId: r.id });
      if (!others.length)
        throw new ConflictError('LAST_ADMIN', 'No one else could administer access after this change');
    }
    await d.accessRepo.replaceRolePermissions(
      r.id,
      [...next.entries()].map(([code, scope]) => ({ code, scope })),
    );
    const holders = await d.accessRepo.roleHolders(r.id, today);
    await bumpAndInvalidate(d, holders);
    const added = [...next.keys()].filter((c) => !before.has(c));
    return {
      role: r,
      added,
      removed: [...before.keys()].filter((c) => !next.has(c)),
      rescoped: [...next.entries()].filter(([c, s]) => before.has(c) && before.get(c) !== s).map(([c]) => c),
      sensitiveAdded: added.filter((c) => catalogue.get(c)!.isSensitive),
      usersAffected: holders.length,
    };
  }
}

export class DeleteRole extends UseCase<{ id: string }, void> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.accessRepo.role(id);
    if (!r) throw new NotFoundError();
    if (r.isSystem) throw new ConflictError('SYSTEM_ROLE', 'Built-in roles cannot be deleted');
    if ((await this.d.accessRepo.roleHolders(id, LocalDate.today(this.d.clock).iso)).length)
      throw new ConflictError('ROLE_IN_USE', 'Revoke the role from its users first');
    await this.d.accessRepo.deleteRole(id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Users and assignments
// ---------------------------------------------------------------------------------------------------------------

export class ListUsers extends Query<
  { q?: string; userType?: string; roleId?: string; campusId?: string; status?: string; limit: number; offset: number },
  Array<UserRow & { roles: Array<{ code: string; campusId: string | null }> }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    q?: string;
    userType?: string;
    roleId?: string;
    campusId?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    const users = await this.d.accessRepo.users(i);
    const out = [];
    for (const u of users)
      out.push({
        ...u,
        roles: (await this.d.accessRepo.assignments(u.id)).map((a) => ({ code: a.roleCode, campusId: a.campusId })),
      });
    return out;
  }
}

export interface EffectiveAccess {
  user: UserRow;
  assignments: Array<AssignmentRow & { active: boolean }>;
  /** permission -> where it applies (from active assignments) */
  permissions: Record<string, Array<{ scope: DataScope; campusId: string | null; viaRole: string }>>;
}

async function effective(d: Deps, userId: string): Promise<EffectiveAccess> {
  const user = await d.accessRepo.user(userId);
  if (!user) throw new NotFoundError();
  const today = LocalDate.today(d.clock).iso;
  const assignments = (await d.accessRepo.assignments(userId)).map((a) => ({
    ...a,
    active: a.validFrom <= today && (!a.validTo || a.validTo >= today),
  }));
  const permissions: EffectiveAccess['permissions'] = {};
  for (const a of assignments.filter((x) => x.active))
    for (const p of await d.accessRepo.rolePermissions(a.roleId))
      (permissions[p.code] ??= []).push({
        scope: p.scope,
        campusId: a.scopeType === 'org' ? null : a.campusId,
        viaRole: a.roleCode,
      });
  return { user, assignments, permissions };
}

export class GetUserAccess extends Query<{ userId: string }, EffectiveAccess> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle({ userId }: { userId: string }) {
    return effective(this.d, userId);
  }
}

/** "Can this user do X on this campus, and why?" */
export class CheckAccess extends Query<
  { userId: string; permission: string; campusId?: string },
  { allowed: boolean; via: Array<{ scope: DataScope; campusId: string | null; viaRole: string }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { userId: string; permission: string; campusId?: string }) {
    const { permissions, user } = await effective(this.d, i.userId);
    const grants = (permissions[i.permission] ?? []).filter(
      (g) => !i.campusId || g.campusId === null || g.campusId === i.campusId,
    );
    return { allowed: user.status === 'active' && grants.length > 0, via: grants };
  }
}

export class AssignRole extends UseCase<
  { userId: string; roleId: string; campusId?: string | null; validFrom?: string; validTo?: string },
  AssignmentRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    userId: string;
    roleId: string;
    campusId?: string | null;
    validFrom?: string;
    validTo?: string;
  }) {
    const { d } = this;
    if (i.userId === d.ctx.userId) throw new ForbiddenError('SELF_ASSIGNMENT', 'You cannot change your own roles');
    const user = await d.accessRepo.user(i.userId);
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    const r = await d.accessRepo.role(i.roleId);
    if (!r) throw new NotFoundError('Role not found', 'ROLE_NOT_FOUND');
    const expected = userTypeForRole(r.code);
    if (user.userType !== expected)
      throw new InvariantError(
        'ROLE_USER_TYPE',
        `${r.code} is for ${expected} accounts, this is a ${user.userType} account`,
      );
    const campusId = i.campusId ? d.scopePolicy.requireCampus(i.campusId) : null;
    if (!campusId && d.ctx.campusIds !== '*')
      throw new ForbiddenError(
        'ORG_WIDE_NOT_ALLOWED',
        'Only organisation-wide administrators assign organisation-wide roles',
      );
    const validFrom = i.validFrom ?? LocalDate.today(d.clock).iso;
    if (i.validTo && i.validTo < validFrom) throw new InvariantError('DATE_RANGE_INVALID', 'Ends before it starts');
    if ((await d.accessRepo.assignments(i.userId)).some((a) => a.roleId === r.id && a.campusId === campusId))
      throw new ConflictError('ROLE_ALREADY_ASSIGNED', 'The user already has this role here');
    const id = await d.accessRepo.insertAssignment({
      orgId: d.ctx.orgId,
      userId: i.userId,
      roleId: r.id,
      scopeType: campusId ? 'campus' : 'org',
      campusId,
      validFrom,
      validTo: i.validTo ?? null,
      grantedBy: d.ctx.userId,
    });
    await bumpAndInvalidate(d, [i.userId]);
    return (await d.accessRepo.assignment(id))!;
  }
}

export class RevokeAssignment extends UseCase<{ id: string }, void> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const a = await d.accessRepo.assignment(id);
    if (!a) throw new NotFoundError();
    if (a.userId === d.ctx.userId) throw new ForbiddenError('SELF_ASSIGNMENT', 'You cannot change your own roles');
    if (a.campusId) d.scopePolicy.requireCampus(a.campusId);
    else if (d.ctx.campusIds !== '*') throw new ForbiddenError('ORG_WIDE_NOT_ALLOWED', 'Organisation-wide role');
    const grantsAdmin = (await d.accessRepo.rolePermissions(a.roleId)).some((p) => p.code === ADMIN_PERMISSION);
    if (grantsAdmin) {
      const others = await d.accessRepo.permissionHolders(ADMIN_PERMISSION, LocalDate.today(d.clock).iso, {
        assignmentId: id,
      });
      if (!others.filter((u) => u !== a.userId).length)
        throw new ConflictError('LAST_ADMIN', 'This is the last account that can administer access');
    }
    await d.accessRepo.deleteAssignment(id);
    await bumpAndInvalidate(d, [a.userId]);
  }
}

export class SetUserStatus extends UseCase<{ userId: string; status: 'active' | 'disabled' }, UserRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { userId: string; status: 'active' | 'disabled' }) {
    const { d } = this;
    if (i.userId === d.ctx.userId) throw new ForbiddenError('SELF_STATUS', 'You cannot disable your own account');
    const u = await d.accessRepo.user(i.userId);
    if (!u) throw new NotFoundError();
    if (i.status === 'disabled') {
      const admins = await d.accessRepo.permissionHolders(ADMIN_PERMISSION, LocalDate.today(d.clock).iso);
      if (admins.includes(u.id) && admins.length === 1)
        throw new ConflictError('LAST_ADMIN', 'This is the last account that can administer access');
    }
    await d.accessRepo.setUserStatus(u.id, i.status);
    await bumpAndInvalidate(d, [u.id]);
    return (await d.accessRepo.user(u.id))!;
  }
}
