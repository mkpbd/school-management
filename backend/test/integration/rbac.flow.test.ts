/**
 * RBAC administration end-to-end: permission catalogue, the specified roles, custom role with a permission matrix,
 * campus-scoped assignment taking effect immediately (stale token refused), access check, guards (self-assignment,
 * self role edit, account type, duplicates, system / in-use roles), disabling an account.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const customCode = () => `FEE_VIEWER_${run}`.toUpperCase().slice(0, 40);

const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) => request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`),
  put: (url: string) => request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`),
  del: (url: string) => request(t.app).delete(url).set('Authorization', `Bearer ${tokens[who]}`),
});

async function login(username: string): Promise<{ status: number; token?: string }> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  return { status: res.status, token: res.body.data?.accessToken as string | undefined };
}

beforeAll(async () => {
  t = await createTestApp([]);
  run = t.owner.runId;
  ids.dhn = await t.owner.campusId('DHN');
  ids.gul = await t.owner.campusId('GUL');
  const it = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'IT_ADMIN' });
  ids.itUser = it.id;
  tokens.it = (await login(it.username)).token!;
  const target = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'CLASS_TEACHER', campusCode: 'DHN' });
  ids.target = target.id;
  ids.targetName = target.username;
  tokens.target = (await login(target.username)).token!;
});

afterAll(async () => {
  await t.close();
});

describe('roles and permissions', () => {
  it('catalogue per module / resource / action and the specified roles', async () => {
    const cat = await as('it').get('/api/v1/iam/permissions');
    expect(cat.status, JSON.stringify(cat.body)).toBe(200);
    const fee = cat.body.data.find((m: { module: string }) => m.module === 'fee');
    const invoice = fee.resources.find((r: { resource: string }) => r.resource === 'invoice');
    expect(invoice.actions.map((a: { action: string }) => a.action).sort()).toEqual([
      'create',
      'delete',
      'edit',
      'export',
      'view',
    ]);

    const roles = await as('it').get('/api/v1/iam/roles');
    const codes = roles.body.data.map((r: { code: string }) => r.code);
    for (const code of [
      'PRINCIPAL',
      'VICE_PRINCIPAL',
      'HEAD_OF_SECTION',
      'CLASS_TEACHER',
      'SUBJECT_TEACHER',
      'ACCOUNTANT',
      'ADMISSION_OFFICER',
      'LIBRARIAN',
      'TRANSPORT',
      'PARENT',
      'STUDENT',
      'IT_ADMIN',
    ])
      expect(codes).toContain(code);
    for (const r of roles.body.data) ids[`role_${r.code}`] = r.id;

    const matrix = await as('it').get('/api/v1/iam/role-matrix?module=lib');
    expect(matrix.body.data.cells.LIBRARIAN['lib.catalogue.view']).toBe('campus');
    expect(matrix.body.data.cells.STUDENT['lib.catalogue.view']).toBe('self');
    expect((await as('target').get('/api/v1/iam/roles')).status).toBe(403);
  });

  it('custom role: copy, edit the matrix (module x action x scope), guards', async () => {
    const role = await as('it').post('/api/v1/iam/roles').send({
      code: customCode(),
      nameEn: 'Fee viewer',
      copyFromRoleId: ids.role_CLASS_TEACHER,
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    expect(role.body.data.permissions.length).toBeGreaterThan(3);
    ids.custom = role.body.data.id;
    expect((await as('it').post('/api/v1/iam/roles').send({ code: 'bad code', nameEn: 'x' })).body.code).toBe(
      'ROLE_CODE_INVALID',
    );

    const set = await as('it')
      .put(`/api/v1/iam/roles/${ids.custom}/permissions`)
      .send({
        permissions: [
          { code: 'fee.invoice.view', scope: 'campus' },
          { code: 'fee.payment.view', scope: 'campus' },
          { code: 'sis.student.view', scope: 'campus' },
        ],
      });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data.added.sort()).toEqual(['fee.invoice.view', 'fee.payment.view']);
    expect(set.body.data.removed.length).toBeGreaterThan(0);
    const unknown = await as('it')
      .put(`/api/v1/iam/roles/${ids.custom}/permissions`)
      .send({ permissions: [{ code: 'fee.rocket.launch', scope: 'org' }] });
    expect(unknown.status).toBe(422);
    const own = await as('it').put(`/api/v1/iam/roles/${ids.role_IT_ADMIN}/permissions`).send({ permissions: [] });
    expect(own.body.code).toBe('SELF_ROLE_EDIT');
    expect((await as('it').del(`/api/v1/iam/roles/${ids.role_PRINCIPAL}`)).body.code).toBe('SYSTEM_ROLE');
  });
});

describe('assignments per campus', () => {
  it('assigning applies at once: old token refused, new login sees the permission on that campus only', async () => {
    expect((await as('target').get(`/api/v1/fee/invoices?campusId=${ids.dhn}`)).status).toBe(403);
    const assign = await as('it')
      .post(`/api/v1/iam/users/${ids.target}/roles`)
      .send({ roleId: ids.custom, campusId: ids.dhn });
    expect(assign.status, JSON.stringify(assign.body)).toBe(201);
    expect(assign.body.data).toMatchObject({ scopeType: 'campus', campusId: ids.dhn });
    ids.assignment = assign.body.data.id;

    const stale = await as('target').get(`/api/v1/fee/invoices?campusId=${ids.dhn}`);
    expect(stale.status).toBe(401);
    tokens.target = (await login(ids.targetName!)).token!;
    expect((await as('target').get(`/api/v1/fee/invoices?campusId=${ids.dhn}`)).status).toBe(200);

    const yes = await as('it').get(
      `/api/v1/iam/users/${ids.target}/check?permission=fee.invoice.view&campusId=${ids.dhn}`,
    );
    expect(yes.body.data.allowed).toBe(true);
    expect(yes.body.data.via[0]).toMatchObject({ scope: 'campus', campusId: ids.dhn });
    const no = await as('it').get(
      `/api/v1/iam/users/${ids.target}/check?permission=fee.invoice.view&campusId=${ids.gul}`,
    );
    expect(no.body.data.allowed).toBe(false);

    const access = await as('it').get(`/api/v1/iam/users/${ids.target}/access`);
    expect(access.body.data.assignments.map((a: { roleCode: string }) => a.roleCode)).toEqual(
      expect.arrayContaining(['CLASS_TEACHER', customCode()]),
    );
    expect(access.body.data.permissions['fee.payment.view']).toEqual([
      { scope: 'campus', campusId: ids.dhn, viaRole: customCode() },
    ]);
  });

  it('guards: self-assignment, account type, duplicates, role in use', async () => {
    expect(
      (await as('it').post(`/api/v1/iam/users/${ids.itUser}/roles`).send({ roleId: ids.role_PRINCIPAL })).body.code,
    ).toBe('SELF_ASSIGNMENT');
    expect(
      (await as('it').post(`/api/v1/iam/users/${ids.target}/roles`).send({ roleId: ids.role_PARENT })).body.code,
    ).toBe('ROLE_USER_TYPE');
    expect(
      (await as('it').post(`/api/v1/iam/users/${ids.target}/roles`).send({ roleId: ids.custom, campusId: ids.dhn }))
        .body.code,
    ).toBe('ROLE_ALREADY_ASSIGNED');
    expect((await as('it').del(`/api/v1/iam/roles/${ids.custom}`)).body.code).toBe('ROLE_IN_USE');

    const users = await as('it').get(`/api/v1/iam/users?q=${encodeURIComponent(ids.targetName!)}`);
    expect(users.body.data[0].roles.map((r: { code: string }) => r.code)).toContain(customCode());

    expect((await as('it').del(`/api/v1/iam/role-assignments/${ids.assignment}`)).status).toBe(204);
    expect((await as('it').del(`/api/v1/iam/roles/${ids.custom}`)).status).toBe(204);
  });

  it('disabling an account locks it out at once', async () => {
    tokens.target = (await login(ids.targetName!)).token!;
    const off = await as('it').post(`/api/v1/iam/users/${ids.target}/status`).send({ status: 'disabled' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await as('target').get('/api/v1/me')).status).toBe(401);
    expect((await login(ids.targetName!)).status).not.toBe(200);
    expect((await as('it').post(`/api/v1/iam/users/${ids.itUser}/status`).send({ status: 'disabled' })).body.code).toBe(
      'SELF_STATUS',
    );
    await as('it').post(`/api/v1/iam/users/${ids.target}/status`).send({ status: 'active' });
    expect((await login(ids.targetName!)).status).toBe(200);
  });
});
