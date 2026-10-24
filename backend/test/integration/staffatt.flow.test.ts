/**
 * Staff attendance end-to-end: leave (balances, eligibility, approval -> attendance) -> check-in / out (late,
 * overtime, geofence) -> HR register -> month summary -> payroll pulls unpaid days and overtime.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { LocalDate } from '../../src/shared/domain/LocalDate.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const MONTH = '2091-12';
let SUN = LocalDate.parse(`${MONTH}-01`);
while (SUN.dayOfWeek() !== 0) SUN = SUN.addDays(1);
const day = (n: number) => SUN.addDays(n); // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 7 next Sun, 8 next Mon
const at = (d: LocalDate, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(
      ...((d.iso.split('-').map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [
        number,
        number,
        number,
      ]),
      h - 6,
      m,
    ),
  ); // Dhaka = UTC+6
};
const CAMPUS = { lat: 23.7806, lng: 90.4193 };

const clock = new FixedClock(at(day(0), '07:00'));
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app)
      .post(url)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}-${Date.now()}`),
  put: (url: string) =>
    request(t.app)
      .put(url)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}-${Date.now()}`),
});

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  ids.org = await t.owner.orgId();
  await t.owner.query(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, 'TEST-2091', '2091-01-01', '2091-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open'`,
    [ids.org],
  );
  const [campus] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.campus (org_id, code, name_en) VALUES ($1, $2, $3) RETURNING id`,
    [ids.org, `A${run}`, `Attendance campus ${run}`],
  );
  ids.campus = campus!.id;
  for (const [who, roleCode] of [
    ['hr', 'HR'],
    ['it', 'IT_ADMIN'],
  ] as const) {
    tokens[who] = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode })).username);
  }
  const mk = async (no: string, gender: 'male' | 'female') => {
    const res = await as('hr')
      .post('/api/v1/hrm/staff')
      .send({
        campusId: ids.campus,
        staffNo: `${no}-${run}`,
        fullNameEn: `Staff ${no}`,
        gender,
        phone: `+88017${String(Date.now() + no.length).slice(-8)}`,
        staffType: 'teaching',
        joinedOn: '2090-01-01',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };
  ids.teacher = await mk('F1', 'female');
  ids.male = await mk('M01', 'male');
  const acc = await as('it')
    .post(`/api/v1/hrm/staff/${ids.teacher}/account`)
    .send({ username: `att.f1.${run}`, password: PASSWORD, roleCode: 'CLASS_TEACHER', campusId: ids.campus });
  expect(acc.status, JSON.stringify(acc.body)).toBe(201);
  tokens.teacher = await login(`att.f1.${run}`);
  const types = await as('teacher').get('/api/v1/att/staff-leave-types');
  for (const ty of types.body.data as Array<{ id: string; code: string }>) ids[`type${ty.code}`] = ty.id;
});

afterAll(async () => {
  await t.close();
});

describe('staff leave', () => {
  it('balances, eligibility, apply, approve (attendance marked), not by oneself', async () => {
    const bal = await as('teacher').get('/api/v1/att/staff-leave-balances?year=2091');
    expect(bal.status, JSON.stringify(bal.body)).toBe(200);
    expect(bal.body.data.find((b: { code: string }) => b.code === 'CL')).toMatchObject({ entitled: 10, available: 10 });
    expect(bal.body.data.map((b: { code: string }) => b.code)).toContain('ML'); // female

    const male = await as('hr')
      .post('/api/v1/att/staff-leaves')
      .send({ staffId: ids.male, leaveTypeId: ids.typeML, fromDate: day(1).iso, toDate: day(1).iso });
    expect(male.body.code).toBe('LEAVE_NOT_ELIGIBLE');

    // Sun..Mon (+ Friday off in between doesn't matter here): 2 school days of casual leave
    const cl = await as('teacher')
      .post('/api/v1/att/staff-leaves')
      .send({ leaveTypeId: ids.typeCL, fromDate: day(0).iso, toDate: day(1).iso, reason: 'Family event' });
    expect(cl.status, JSON.stringify(cl.body)).toBe(201);
    expect(cl.body.data).toMatchObject({ days: 2, status: 'pending' });
    ids.cl = cl.body.data.id;
    const overlap = await as('teacher')
      .post('/api/v1/att/staff-leaves')
      .send({ leaveTypeId: ids.typeLWP, fromDate: day(1).iso, toDate: day(2).iso });
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');
    const lwp = await as('teacher')
      .post('/api/v1/att/staff-leaves')
      .send({ leaveTypeId: ids.typeLWP, fromDate: day(2).iso, toDate: day(2).iso });
    expect(lwp.status, JSON.stringify(lwp.body)).toBe(201);
    ids.lwp = lwp.body.data.id;
    // friday is not a working day: a Friday-only request has no days
    const fri = await as('teacher')
      .post('/api/v1/att/staff-leaves')
      .send({ leaveTypeId: ids.typeCL, fromDate: day(5).iso, toDate: day(5).iso });
    expect(fri.body.code).toBe('NO_WORKING_DAYS');

    const self = await as('teacher').post(`/api/v1/att/staff-leaves/${ids.cl}/decide`).send({ decision: 'approved' });
    expect(self.status).toBe(403);
    for (const id of [ids.cl, ids.lwp]) {
      const ok = await as('hr').post(`/api/v1/att/staff-leaves/${id}/decide`).send({ decision: 'approved' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }
    const after = await as('hr').get(`/api/v1/att/staff-leave-balances?year=2091&staffId=${ids.teacher}`);
    expect(after.body.data.find((b: { code: string }) => b.code === 'CL')).toMatchObject({
      taken: 2,
      pending: 0,
      available: 8,
    });
  });
});

describe('daily attendance', () => {
  it('self check-in late and check-out with overtime', async () => {
    clock.set(at(day(3), '08:25'));
    const inRes = await as('teacher').post('/api/v1/att/staff/me/check-in').send({});
    expect(inRes.status, JSON.stringify(inRes.body)).toBe(200);
    expect(inRes.body.data).toMatchObject({ status: 'late', lateMinutes: 25, source: 'mobile_geo' });
    expect((await as('teacher').post('/api/v1/att/staff/me/check-in').send({})).body.code).toBe('ALREADY_CHECKED_IN');
    clock.set(at(day(3), '16:00'));
    const out = await as('teacher').post('/api/v1/att/staff/me/check-out').send({});
    expect(out.body.data).toMatchObject({ status: 'late', overtimeMinutes: 60, earlyLeaveMinutes: 0 });

    clock.set(at(day(0), '09:00'));
    const onLeave = await as('teacher').post('/api/v1/att/staff/me/check-in').send({});
    expect(onLeave.body.code).toBe('ON_LEAVE');
  });

  it('campus geofence', async () => {
    await t.owner.query(
      `INSERT INTO core.setting (org_id, campus_id, key, value) VALUES ($1, $2, 'att.staff_geofence', $3)`,
      [ids.org, ids.campus, JSON.stringify({ ...CAMPUS, radiusMeters: 200 })],
    );
    clock.set(at(day(4), '07:55'));
    expect((await as('teacher').post('/api/v1/att/staff/me/check-in').send({})).body.code).toBe('LOCATION_REQUIRED');
    const far = await as('teacher')
      .post('/api/v1/att/staff/me/check-in')
      .send({ lat: CAMPUS.lat + 0.01, lng: CAMPUS.lng });
    expect(far.status).toBe(403);
    expect(far.body.code).toBe('OUTSIDE_CAMPUS');
    const ok = await as('teacher')
      .post('/api/v1/att/staff/me/check-in')
      .send({ lat: CAMPUS.lat + 0.0005, lng: CAMPUS.lng });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'present', lateMinutes: 0 });
  });

  it('HR register: absent and half day; month summary; payroll pulls it', async () => {
    clock.set(at(day(9), '18:00'));
    for (const [d, status] of [
      [day(7), 'absent'],
      [day(8), 'half_day'],
    ] as const) {
      const res = await as('hr')
        .put(`/api/v1/att/staff-daily?campusId=${ids.campus}&date=${d.iso}`)
        .send({ entries: [{ staffId: ids.teacher, status }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const sheet = await as('hr').get(`/api/v1/att/staff-daily?campusId=${ids.campus}&date=${day(7).iso}`);
    expect(sheet.body.data.rows.find((r: { staffId: string }) => r.staffId === ids.teacher).day.status).toBe('absent');

    const month = await as('teacher').get(`/api/v1/att/staff-month?month=${MONTH}`);
    expect(month.status, JSON.stringify(month.body)).toBe(200);
    expect(month.body.data.summary).toMatchObject({
      leave: 3,
      unpaidLeave: 1,
      paidLeave: 2,
      late: 1,
      absent: 1,
      halfDay: 1,
      overtimeMinutes: 60,
      lwpDays: 2.5, // 1 unpaid leave + 1 absent + 0.5 half day
    });

    const contract = await as('hr')
      .post(`/api/v1/hrm/staff/${ids.teacher}/contracts`)
      .send({
        contractType: 'permanent',
        startsOn: '2090-01-01',
        basicPaisa: 3_000_000,
        components: [{ componentCode: 'OT', amountPaisa: 20_000 }],
      });
    expect(contract.status, JSON.stringify(contract.body)).toBe(201);
    const payroll = await as('hr').post('/api/v1/hrm/payroll-runs').send({ campusId: ids.campus, month: MONTH });
    expect(payroll.status, JSON.stringify(payroll.body)).toBe(201);
    const pulled = await as('hr')
      .post(`/api/v1/hrm/payroll-runs/${payroll.body.data.id}/inputs/from-attendance`)
      .send();
    expect(pulled.status, JSON.stringify(pulled.body)).toBe(200);
    expect(pulled.body.data.rows.find((r: { staffId: string }) => r.staffId === ids.teacher)).toMatchObject({
      lwpDays: 2.5,
      overtimeMinutes: 60,
      lwpBreakdown: { unpaidLeave: 1, absent: 1, halfDay: 0.5, late: 0 },
    });
    const computed = await as('hr').post(`/api/v1/hrm/payroll-runs/${payroll.body.data.id}/compute`).send();
    expect(computed.status, JSON.stringify(computed.body)).toBe(200);
    const sheetRun = await as('hr').get(`/api/v1/hrm/payroll-runs/${payroll.body.data.id}`);
    const slip = sheetRun.body.data.payslips.find((p: { staffId: string }) => p.staffId === ids.teacher);
    // 31-day month: 30,000 / 31 x 2.5 = 2,419.35 unpaid; OT 1 h x 200
    expect(slip).toMatchObject({ lwpDays: 2.5, netPaisa: 3_000_000 - 241_935 + 20_000 });
  });

  it('cancelling an approved leave returns the days and clears the attendance', async () => {
    const res = await as('hr').post(`/api/v1/att/staff-leaves/${ids.cl}/cancel`).send();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bal = await as('hr').get(`/api/v1/att/staff-leave-balances?year=2091&staffId=${ids.teacher}`);
    expect(bal.body.data.find((b: { code: string }) => b.code === 'CL')).toMatchObject({ taken: 0, available: 10 });
    const month = await as('teacher').get(`/api/v1/att/staff-month?month=${MONTH}`);
    expect(month.body.data.summary.leave).toBe(1);
  });
});
