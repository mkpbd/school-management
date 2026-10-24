import { describe, expect, it } from 'vitest';
import type { DataScope, RequestContext } from '../../src/shared/application/RequestContext.js';
import { ScopePolicy } from '../../src/shared/application/ScopePolicy.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import {
  RevokeAssignment,
  SetRolePermissions,
  userTypeForRole,
  type AccessRepository,
  type AssignmentRow,
} from '../../src/modules/iam/application/AccessControlUseCases.js';

/** One admin role held by one user (u-admin); the caller (u-it) holds another role. */
function setup(adminHolders: string[]) {
  const perms = new Map<string, Array<{ code: string; scope: DataScope }>>([
    ['r-admin', [{ code: 'iam.role.edit', scope: 'org' }]],
    ['r-it', [{ code: 'iam.user.edit', scope: 'org' }]],
  ]);
  const assignment: AssignmentRow = {
    id: 'a-1',
    userId: 'u-admin',
    roleId: 'r-admin',
    roleCode: 'ADMIN',
    roleName: 'Admin',
    scopeType: 'org',
    campusId: null,
    validFrom: '2000-01-01',
    validTo: null,
    grantedBy: null,
  };
  const repo = {
    permissions: async () => [
      { code: 'iam.role.edit', module: 'iam', resource: 'role', action: 'edit', isSensitive: true, description: null },
      { code: 'iam.user.edit', module: 'iam', resource: 'user', action: 'edit', isSensitive: true, description: null },
    ],
    role: async (id: string) => ({
      id,
      code: id.toUpperCase(),
      nameEn: id,
      nameBn: null,
      isSystem: false,
      requiresMfa: false,
    }),
    rolePermissions: async (id: string) => perms.get(id) ?? [],
    roleHolders: async (id: string) => (id === 'r-it' ? ['u-it'] : ['u-admin']),
    permissionHolders: async (_code: string, _d: string, except: { roleId?: string; assignmentId?: string } = {}) =>
      except.roleId === 'r-admin' || except.assignmentId === 'a-1'
        ? adminHolders.filter((u) => u !== 'u-admin')
        : adminHolders,
    replaceRolePermissions: async (id: string, rows: Array<{ code: string; scope: DataScope }>) =>
      void perms.set(id, rows),
    assignment: async () => assignment,
    deleteAssignment: async () => undefined,
    bumpAuthz: async () => undefined,
  } as unknown as AccessRepository;
  const ctx = {
    orgId: 'o',
    userId: 'u-it',
    userType: 'staff',
    campusIds: '*',
    grants: { campusIds: '*', byPermission: {} },
  } as unknown as RequestContext;
  const deps = {
    uow: { run: <T>(fn: () => Promise<T>) => fn(), afterCommit: () => undefined },
    ctx,
    clock: new FixedClock(new Date('2091-01-01T00:00:00Z')),
    accessRepo: repo,
    scopePolicy: new ScopePolicy({ ctx, scopeResolvers: [] }),
    identityProvider: { invalidate: async () => undefined },
  };
  return deps;
}

describe('access control guards', () => {
  it('the last access administrator cannot be removed (role edit or revocation)', async () => {
    const lonely = setup(['u-admin']);
    await expect(
      new SetRolePermissions(lonely as never).execute({ id: 'r-admin', permissions: [] }),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    await expect(new RevokeAssignment(lonely as never).execute({ id: 'a-1' })).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });

    const two = setup(['u-admin', 'u-other']);
    const r = await new SetRolePermissions(two as never).execute({ id: 'r-admin', permissions: [] });
    expect(r.removed).toEqual(['iam.role.edit']);
  });

  it('a role you hold cannot be edited by you', async () => {
    const d = setup(['u-admin', 'u-other']);
    await expect(
      new SetRolePermissions(d as never).execute({
        id: 'r-it',
        permissions: [{ code: 'iam.role.edit', scope: 'org' }],
      }),
    ).rejects.toMatchObject({ code: 'SELF_ROLE_EDIT' });
  });

  it('roles fit account types', () => {
    expect(userTypeForRole('PARENT')).toBe('guardian');
    expect(userTypeForRole('STUDENT')).toBe('student');
    expect(userTypeForRole('LIBRARIAN')).toBe('staff');
  });
});
