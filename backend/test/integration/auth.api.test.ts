import { generate, generateSecret } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FieldCipher } from '../../src/shared/application/ports.js';
import type { ProviderRegistry } from '../../src/modules/com/application/ports.js';
import type { ConsoleSmsProvider } from '../../src/modules/com/infrastructure/ConsoleProviders.js';
import { cookiesFrom, createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
let t: TestApp;
let principal: { id: string; username: string };
let cashier: { id: string; username: string };

const login = (identifier: string, password: string, client = 'staff_app') =>
  request(t.app).post('/api/v1/auth/login').send({ identifier, password, client });

beforeAll(async () => {
  t = await createTestApp();
  principal = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'PRINCIPAL' });
  cashier = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'CASHIER', campusCode: 'DHN' });
});

afterAll(async () => {
  await t.close();
});

describe('password login', () => {
  it('app client: tokens in body, bearer works on /me with grants', async () => {
    const res = await login(principal.username, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ user: { id: principal.id, type: 'staff' }, expiresIn: 900 });
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.mfaEnrollmentRequired).toBe(true); // PRINCIPAL role requires MFA (seed)

    const me = await request(t.app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.campusIds).toBe('*');
    expect(me.body.data.permissions['fee.payment.approve']).toEqual(['org']);
  });

  it('web client: httpOnly cookies, CSRF enforced on unsafe methods', async () => {
    const res = await login(principal.username, PASSWORD, 'web');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeUndefined();
    const { header, map } = cookiesFrom(res.headers['set-cookie']);
    expect(Object.keys(map)).toEqual(expect.arrayContaining(['access', 'refresh', 'csrf']));
    expect(String(res.headers['set-cookie'])).toMatch(/access=[^;]+;.*HttpOnly/);

    const me = await request(t.app).get('/api/v1/me').set('Cookie', header);
    expect(me.status).toBe(200);

    const body = {
      purpose: 'notice_attachment',
      fileName: 'circular.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    };
    const noCsrf = await request(t.app)
      .post('/api/v1/files/uploads')
      .set('Cookie', header)
      .set('Idempotency-Key', 'csrf-test-0001')
      .send(body);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF_FAILED');
    const withCsrf = await request(t.app)
      .post('/api/v1/files/uploads')
      .set('Cookie', header)
      .set('X-CSRF-Token', map.csrf!)
      .set('Idempotency-Key', 'csrf-test-0002')
      .send(body);
    expect(withCsrf.status).toBe(201);
  });

  it('wrong password: 401 problem+json, and the failure counter is committed', async () => {
    const res = await login(cashier.username, 'wrong-password-123');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    const [row] = await t.owner.query<{ failed_login_count: number }>(
      `SELECT failed_login_count FROM iam.user_account WHERE id = $1`,
      [cashier.id],
    );
    expect(row!.failed_login_count).toBe(1);
    const [audit] = await t.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_event WHERE action = 'LOGIN_FAILED' AND actor_user_id = $1`,
      [cashier.id],
    );
    expect(audit!.n).toBeGreaterThanOrEqual(1);
  });

  it('unknown user gets the same answer (no enumeration)', async () => {
    const res = await login('nobody.here', 'whatever-123');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unauthenticated and malformed requests', async () => {
    expect((await request(t.app).get('/api/v1/me')).body.code).toBe('UNAUTHENTICATED');
    const bad = await request(t.app).get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt');
    expect(bad.status).toBe(401);
    const invalid = await request(t.app).post('/api/v1/auth/login').send({ identifier: '', password: 'x', extra: 1 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['body.identifier', 'body']),
    );
  });
});

describe('campus scope', () => {
  it('X-Campus-Id outside the user scope is refused', async () => {
    const res = await login(cashier.username, PASSWORD);
    const token = res.body.data.accessToken as string;
    const dhn = await t.owner.campusId('DHN');
    const gul = await t.owner.campusId('GUL');
    const me = await request(t.app).get('/api/v1/me').set('Authorization', `Bearer ${token}`).set('X-Campus-Id', dhn);
    expect(me.status).toBe(200);
    expect(me.body.data.campusIds).toEqual([dhn]);
    const other = await request(t.app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Campus-Id', gul);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('OUT_OF_SCOPE');
  });

  it('use-case permission checks: cashier may not upload imports', async () => {
    const res = await login(cashier.username, PASSWORD);
    const upload = await request(t.app)
      .post('/api/v1/files/uploads')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .set('Idempotency-Key', 'import-forbidden-1')
      .send({ purpose: 'import', fileName: 'students.csv', mimeType: 'text/csv', sizeBytes: 100 });
    expect(upload.status).toBe(403);
  });
});

describe('refresh token rotation', () => {
  it('rotates, detects reuse and revokes the whole family', async () => {
    const first = (await login(principal.username, PASSWORD)).body.data;
    const rotated = await request(t.app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(first.refreshToken);

    const reuse = await request(t.app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');

    // the legitimate successor is revoked too (family revoked)
    const successor = await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken });
    expect(successor.status).toBe(401);
    expect(successor.body.code).toBe('REFRESH_INVALID');
  });

  it('logout revokes the session', async () => {
    const s = (await login(principal.username, PASSWORD)).body.data;
    expect((await request(t.app).post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken })).status).toBe(204);
    expect((await request(t.app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });
});

describe('TOTP second factor', () => {
  it('requires a valid one-time code and rejects replay', async () => {
    const secret = generateSecret();
    const cipher = t.container.resolve<FieldCipher>('fieldCipher');
    const mfaUser = await t.owner.createStaffUser({
      password: PASSWORD,
      roleCode: 'ACCOUNTANT',
      campusCode: 'DHN',
      mfaSecretEnc: cipher.encrypt(secret),
    });

    const step1 = await login(mfaUser.username, PASSWORD);
    expect(step1.status).toBe(200);
    expect(step1.body.data.mfaRequired).toBe(true);
    const { mfaToken } = step1.body.data;

    const wrong = await request(t.app)
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken, code: '000000', client: 'staff_app' });
    expect(wrong.status).toBe(401);

    const code = await generate({ secret });
    const ok = await request(t.app).post('/api/v1/auth/mfa/verify').send({ mfaToken, code, client: 'staff_app' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTypeOf('string');

    const replay = await request(t.app).post('/api/v1/auth/mfa/verify').send({ mfaToken, code, client: 'staff_app' });
    expect(replay.status).toBe(401);
  });
});

describe('guardian OTP login (+ notification hub end to end)', () => {
  it('sends the code by SMS via outbox job and signs in with it', async () => {
    const phone = `+88017${String(Date.now()).slice(-8)}`;
    await t.owner.createGuardianUser(phone);
    const sms = (t.container.resolve<ProviderRegistry>('providers').for('sms')[0] as ConsoleSmsProvider).sent;
    sms.length = 0;

    const req = await request(t.app).post('/api/v1/auth/otp/request').send({ phone });
    expect(req.status).toBe(202);
    expect(sms).toHaveLength(1);
    expect(sms[0]!.to).toBe(phone);
    const code = /(\d{6})/.exec(sms[0]!.body)![1]!;

    const [msg] = await t.owner.query<{ status: string; sms_encoding: string }>(
      `SELECT status, sms_encoding FROM com.outbound_message WHERE recipient_address = $1 ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    expect(msg).toMatchObject({ status: 'sent', sms_encoding: 'gsm7' });

    const bad = await request(t.app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: code === '000000' ? '111111' : '000000', client: 'parent_app' });
    expect(bad.status).toBe(401);
    const good = await request(t.app).post('/api/v1/auth/otp/verify').send({ phone, code, client: 'parent_app' });
    expect(good.status).toBe(200);
    expect(good.body.data.user.type).toBe('guardian');
    const again = await request(t.app).post('/api/v1/auth/otp/verify').send({ phone, code, client: 'parent_app' });
    expect(again.status).toBe(401); // single use
  });

  it('unregistered phones get the same 202 and no SMS', async () => {
    const sms = (t.container.resolve<ProviderRegistry>('providers').for('sms')[0] as ConsoleSmsProvider).sent;
    sms.length = 0;
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({ phone: '+8801999999999' });
    expect(res.status).toBe(202);
    expect(sms).toHaveLength(0);
  });
});
