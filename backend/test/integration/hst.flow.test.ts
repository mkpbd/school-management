/**
 * Hostel end-to-end: hostel / rooms / beds -> allocation (gender, double booking, fee items) -> occupancy ->
 * night roll call (absence SMS) -> out-pass (guardian request, warden approval, gate out / in, overdue alert)
 * -> visitors -> transfer / vacate (fee items follow) -> parent view.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const START = new Date('2091-08-12T13:00:00Z'); // 19:00 Dhaka
const DAY = '2091-08-12';
const clock = new FixedClock(START);
const HOUR = 3_600_000;

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

async function guardianLogin(phone: string): Promise<string> {
  expect((await request(t.app).post('/api/v1/auth/otp/request').send({ phone })).status).toBe(202);
  const [msg] = await t.owner.query<{ body: string }>(
    `SELECT body FROM com.outbound_message WHERE event_code = 'iam.otp' AND recipient_address = $1 ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  const code = /(\d{6})/.exec(msg!.body)![1]!;
  const res = await request(t.app).post('/api/v1/auth/otp/verify').send({ phone, code, client: 'parent_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

async function drainOutbox(): Promise<number> {
  const { db, pool, logger, metrics } = t.container.cradle;
  const relay = new OutboxRelay({
    db,
    pool,
    eventBus: t.container.resolve<EventBus>('eventBus'),
    subscriptions: t.container.resolve<SubscriptionRegistry>('subscriptions'),
    logger,
    metrics,
  });
  return relay.drain();
}

const sms = (dedupeKey: string) =>
  t.owner.query<{ body: string; recipient_address: string }>(
    `SELECT body, recipient_address FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
    [dedupeKey],
  );
const feeItems = (allocationId: string) =>
  t.owner.query<{ code: string; amount_paisa: number; valid_to: string | null }>(
    `SELECT h.code, i.amount_paisa, i.valid_to::text FROM fee.student_fee_item i JOIN fee.fee_head h ON h.id = i.fee_head_id
      WHERE i.source_module = 'hst' AND i.source_ref = $1 ORDER BY h.code`,
    [allocationId],
  );

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, 'TEST-2091', '2091-01-01', '2091-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId],
  );
  const [y8] = await t.owner.query<{ id: string }>(
    `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = 'Y8'`,
    [orgId],
  );
  await t.owner.query(
    `INSERT INTO core.setting (org_id, campus_id, key, value) VALUES ($1, $2, 'hst.meal_fee_paisa', '250000')
     ON CONFLICT (org_id, campus_id, key) DO UPDATE SET value = excluded.value`,
    [orgId, ids.dhn],
  );
  for (const [who, roleCode] of [
    ['warden', 'WARDEN'],
    ['gate', 'FRONT_DESK'],
    ['coord', 'ACADEMIC_COORDINATOR'],
  ] as const) {
    tokens[who] = await login(
      (await t.owner.createStaffUser({ password: PASSWORD, roleCode, campusCode: 'DHN' })).username,
    );
  }
  const section = await as('coord')
    .post('/api/v1/aca/sections')
    .send({
      campusId: ids.dhn,
      academicYearId: year!.id,
      yearGroupId: y8!.id,
      name: `H${run}`,
      displayName: `Y8 H ${run}`,
      capacity: 30,
    });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  for (const [n, key, gender] of [
    [0, 'A', 'male'],
    [1, 'B', 'male'],
    [2, 'G', 'female'],
  ] as const) {
    const phone = `+8801${3 + n}${String(Date.now() + n * 7).slice(-8)}`;
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: `Boarder${key}`,
          lastNameEn: `Hst${run}`,
          gender,
          dateOfBirth: '2078-04-01',
          admittedOn: '2091-01-05',
        },
        guardians: [
          { fullNameEn: `Parent ${key}`, phone, relationship: 'mother', preferredLocale: 'en', isPrimaryContact: true },
        ],
        enrolment: { classSectionId: section.body.data.id },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[`student${key}`] = res.body.data.student.id;
    ids[`phone${key}`] = phone;
  }
});

afterAll(async () => {
  await t.close();
});

describe('structure and allocation', () => {
  it('warden builds a boys hostel with rooms and beds', async () => {
    const h = await as('warden')
      .post('/api/v1/hst/hostels')
      .send({
        campusId: ids.dhn,
        code: `H${run}`.slice(0, 20),
        name: `Boys Hostel ${run}`,
        gender: 'boys',
        phone: '+8801700000001',
      });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    ids.hostel = h.body.data.id;
    const r1 = await as('warden')
      .post(`/api/v1/hst/hostels/${ids.hostel}/rooms`)
      .send({ code: '1-01', floor: 1, roomType: 'double', monthlyFeePaisa: 300_000 });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.data.beds).toBe(2);
    const r2 = await as('warden')
      .post(`/api/v1/hst/hostels/${ids.hostel}/rooms`)
      .send({ code: '1-02', floor: 1, roomType: 'single', monthlyFeePaisa: 500_000 });
    ids.room2 = r2.body.data.roomId;
    const dorm = await as('warden')
      .post(`/api/v1/hst/hostels/${ids.hostel}/rooms`)
      .send({ code: 'D-1', roomType: 'dormitory' });
    expect(dorm.body.code).toBe('BED_COUNT_REQUIRED');

    const occ = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/occupancy?date=${DAY}`);
    expect(occ.body.data.totals).toEqual({ beds: 3, occupied: 0, free: 3, inactive: 0 });
    const beds = occ.body.data.rooms.flatMap((r: { code: string; beds: Array<{ bedId: string; code: string }> }) =>
      r.beds.map((b) => ({ room: r.code, ...b })),
    );
    ids.bed1A = beds.find((b: { room: string; code: string }) => b.room === '1-01' && b.code === 'A').bedId;
    ids.bed1B = beds.find((b: { room: string; code: string }) => b.room === '1-01' && b.code === 'B').bedId;
    ids.bed2A = beds.find((b: { room: string }) => b.room === '1-02').bedId;
  });

  it('allocation: gender, one bed per student, one student per bed; rent + meals become fee items', async () => {
    const a = await as('warden')
      .post('/api/v1/hst/allocations')
      .send({ studentId: ids.studentA, bedId: ids.bed1A, validFrom: '2091-08-01' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    ids.allocA = a.body.data.id;
    expect(a.body.data).toMatchObject({ monthlyFeePaisa: 300_000, mealFeePaisa: 250_000 });
    expect(await feeItems(ids.allocA!)).toEqual([
      { code: 'HOSTEL', amount_paisa: 300_000, valid_to: null },
      { code: 'MEAL', amount_paisa: 250_000, valid_to: null },
    ]);

    const taken = await as('warden')
      .post('/api/v1/hst/allocations')
      .send({ studentId: ids.studentB, bedId: ids.bed1A, validFrom: '2091-08-01' });
    expect(taken.body.code).toBe('OVERLAP');
    const girl = await as('warden').post('/api/v1/hst/allocations').send({ studentId: ids.studentG, bedId: ids.bed1B });
    expect(girl.body.code).toBe('HOSTEL_GENDER');
    const twice = await as('warden')
      .post('/api/v1/hst/allocations')
      .send({ studentId: ids.studentA, bedId: ids.bed2A });
    expect(twice.body.code).toBe('ALREADY_ALLOCATED');
    const b = await as('warden')
      .post('/api/v1/hst/allocations')
      .send({ studentId: ids.studentB, bedId: ids.bed1B, validFrom: '2091-08-01', mealPlan: 'none' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    ids.allocB = b.body.data.id;
    expect((await feeItems(ids.allocB!)).map((f) => f.code)).toEqual(['HOSTEL']);

    const occ = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/occupancy?date=${DAY}`);
    expect(occ.body.data.totals).toMatchObject({ beds: 3, occupied: 2, free: 1 });
  });
});

describe('roll call and out-pass', () => {
  it('night roll call: a new absence texts the guardian once', async () => {
    const sheet = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/roll-call?date=${DAY}&session=night`);
    expect(sheet.body.data.rows).toHaveLength(2);
    const entries = [
      { studentId: ids.studentA, status: 'present' },
      { studentId: ids.studentB, status: 'absent' },
    ];
    const mark = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/roll-call?date=${DAY}&session=night`)
      .send({ entries });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    expect(mark.body.data).toEqual({ saved: 2, absentAlerts: 1 });
    const again = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/roll-call?date=${DAY}&session=night`)
      .send({ entries });
    expect(again.body.data.absentAlerts).toBe(0);
    const stranger = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/roll-call?date=${DAY}&session=night`)
      .send({ entries: [{ studentId: ids.studentG, status: 'present' }] });
    expect(stranger.body.code).toBe('NOT_RESIDENT');
    await drainOutbox();
    const [msg] = await sms(`hst.absent:${ids.studentB}:${DAY}:night`);
    expect(msg!.recipient_address).toBe(ids.phoneB);
    expect(msg!.body).toContain('night roll call');
  });

  it('guardian requests, warden approves, gate lets out and in; overdue alert in between', async () => {
    tokens.parentA = await guardianLogin(ids.phoneA!);
    const outFrom = new Date(START.getTime() + 3 * HOUR);
    const returnBy = new Date(START.getTime() + 27 * HOUR);
    const req = await as('parentA').post('/api/v1/hst/outpasses').send({
      studentId: ids.studentA,
      kind: 'home_leave',
      destination: 'Home, Uttara',
      escortName: 'Parent A',
      outFrom: outFrom.toISOString(),
      returnBy: returnBy.toISOString(),
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.data).toMatchObject({ status: 'pending', requestedByType: 'guardian' });
    ids.pass = req.body.data.id;
    const notMine = await as('parentA').post('/api/v1/hst/outpasses').send({
      studentId: ids.studentB,
      kind: 'day_out',
      destination: 'Somewhere',
      outFrom: outFrom.toISOString(),
      returnBy: returnBy.toISOString(),
    });
    expect(notMine.status).toBe(404);

    const ok = await as('warden').post(`/api/v1/hst/outpasses/${ids.pass}/decide`).send({ decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const early = await as('gate').post(`/api/v1/hst/outpasses/${ids.pass}/check-out`).send();
    expect(early.body.code).toBe('OUTPASS_TOO_EARLY');

    clock.set(new Date(outFrom.getTime() - 30 * 60_000));
    const out = await as('gate').post(`/api/v1/hst/outpasses/${ids.pass}/check-out`).send();
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.data.status).toBe('out');
    const sheet = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/roll-call?date=${DAY}&session=night`);
    expect(sheet.body.data.rows.find((r: { studentId: string }) => r.studentId === ids.studentA).outOnPass).toBe(true);

    clock.set(new Date(returnBy.getTime() + 45 * 60_000));
    const overdue = await as('warden').post('/api/v1/hst/tasks/overdue-outpasses').send();
    expect(overdue.body.data.overdue).toBe(1);
    expect((await as('warden').post('/api/v1/hst/tasks/overdue-outpasses').send()).body.data.overdue).toBe(0);
    const back = await as('gate').post(`/api/v1/hst/outpasses/${ids.pass}/check-in`).send();
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.data).toMatchObject({ status: 'returned', minutesLate: 45 });

    await drainOutbox();
    for (const key of ['hst.outpass_decided', 'hst.left', 'hst.overdue', 'hst.returned']) {
      const [m] = await sms(`${key}:${ids.pass}`);
      expect(m?.recipient_address, key).toBe(ids.phoneA);
    }
    expect((await sms(`hst.overdue:${ids.pass}`))[0]!.body).toContain('URGENT');
  });
});

describe('list details', () => {
  it('out-passes and visitors carry the student name; residents carry meal plan and diet', async () => {
    const passes = await as('warden').get(`/api/v1/hst/outpasses?hostelId=${ids.hostel}`);
    expect(passes.status, JSON.stringify(passes.body)).toBe(200);
    expect(passes.body.data.length).toBeGreaterThan(0);
    for (const p of passes.body.data as Array<{ studentName: string; admissionNo: string }>) {
      expect(p.studentName).toMatch(/^Boarder/);
      expect(p.admissionNo).not.toBe('');
    }
    const visitors = await as('warden').get(`/api/v1/hst/visitors?hostelId=${ids.hostel}`);
    for (const v of visitors.body.data as Array<{ studentName: string }>) expect(v.studentName).toMatch(/^Boarder/);
    const residents = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/residents`);
    const row = (residents.body.data as Array<{ studentId: string }>).find((r) => r.studentId === ids.studentA);
    if (row) expect(row).toMatchObject({ mealPlan: 'full', diet: 'regular', dietNote: null });
  });
});

describe('visitors, transfer, vacate, parent view', () => {
  it('visitor log flags the registered guardian', async () => {
    const v = await as('gate')
      .post('/api/v1/hst/visitors')
      .send({ studentId: ids.studentB, visitorName: 'Parent B', relation: 'mother', phone: ids.phoneB });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.data.knownContact).toBe(true);
    const stranger = await as('gate')
      .post('/api/v1/hst/visitors')
      .send({ studentId: ids.studentB, visitorName: 'Uncle', relation: 'uncle', phone: '+8801999000111' });
    expect(stranger.body.data.knownContact).toBe(false);
    expect((await as('gate').post(`/api/v1/hst/visitors/${v.body.data.id}/out`).send()).status).toBe(200);
    expect((await as('gate').post(`/api/v1/hst/visitors/${v.body.data.id}/out`).send()).body.code).toBe('VISITOR_OUT');
  });

  it('transfer moves the rent; vacate stops billing', async () => {
    const moved = await as('warden')
      .post(`/api/v1/hst/allocations/${ids.allocA}/transfer`)
      .send({ bedId: ids.bed2A, fromDate: '2091-09-01' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    expect(moved.body.data).toMatchObject({ bedId: ids.bed2A, validFrom: '2091-09-01', monthlyFeePaisa: 500_000 });
    expect((await feeItems(ids.allocA!)).every((f) => f.valid_to === '2091-08-31')).toBe(true);
    expect((await feeItems(moved.body.data.id as string)).find((f) => f.code === 'HOSTEL')!.amount_paisa).toBe(500_000);

    const left = await as('warden')
      .post(`/api/v1/hst/allocations/${ids.allocB}/vacate`)
      .send({ lastDay: '2091-08-31', reason: 'Day scholar now' });
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect((await feeItems(ids.allocB!))[0]!.valid_to).toBe('2091-08-31');
  });

  it("parent sees their child's room, warden phone and out-passes", async () => {
    clock.set(new Date('2091-09-05T05:00:00Z'));
    const res = await as('parentA').get(`/api/v1/hst/students/${ids.studentA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.allocation).toMatchObject({ roomCode: '1-02', bedCode: 'A' });
    expect(res.body.data.outpasses[0]).toMatchObject({ id: ids.pass, status: 'returned' });
    expect((await as('parentA').get(`/api/v1/hst/students/${ids.studentB}`)).status).toBe(404);
  });
});
