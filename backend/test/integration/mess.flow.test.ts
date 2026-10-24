/**
 * Hostel mess: weekly menu, diets, meal opt-outs by the guardian before the cutoff (warden after it), kitchen headcount
 * (meal plan, away on an out-pass, opted out, diets), servings against the headcount, month report, parent view.
 * Fixed clock in a dedicated test year (2095).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { LocalDate } from '../../src/shared/domain/LocalDate.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const DAY = '2095-02-06';
const at = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00+06:00`);
const clock = new FixedClock(at('10:00'));
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
  put: (url: string) =>
    request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
  patch: (url: string) => request(t.app).patch(url).set('Authorization', `Bearer ${tokens[who]}`),
  del: (url: string) => request(t.app).delete(url).set('Authorization', `Bearer ${tokens[who]}`),
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

const meal = (rows: Array<{ meal: string }>, name: string) =>
  rows.find((m) => m.meal === name) as Record<string, unknown>;

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, 'TEST-2095', '2095-01-01', '2095-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId],
  );
  const [y9] = await t.owner.query<{ id: string }>(
    `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = 'Y9'`,
    [orgId],
  );
  for (const [who, roleCode] of [
    ['warden', 'WARDEN'],
    ['coord', 'ACADEMIC_COORDINATOR'],
  ] as const)
    tokens[who] = await login(
      (await t.owner.createStaffUser({ password: PASSWORD, roleCode, campusCode: 'DHN' })).username,
    );
  const section = await as('coord')
    .post('/api/v1/aca/sections')
    .send({
      campusId: ids.dhn,
      academicYearId: year!.id,
      yearGroupId: y9!.id,
      name: `M${run}`,
      displayName: `Y9 M ${run}`,
      capacity: 30,
    });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  for (const [n, k] of [
    [0, 'A'],
    [1, 'B'],
    [2, 'C'],
  ] as const) {
    const phone = `+8801${5 + n}${String(Date.now() + n * 11).slice(-8)}`;
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: `Eater${k}`,
          lastNameEn: `Mess${run}`,
          gender: 'male',
          dateOfBirth: '2081-04-01',
          admittedOn: '2095-01-05',
        },
        guardians: [
          { fullNameEn: `Parent ${k}`, phone, relationship: 'father', preferredLocale: 'en', isPrimaryContact: true },
        ],
        enrolment: { classSectionId: section.body.data.id },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[`s${k}`] = res.body.data.student.id;
    ids[`phone${k}`] = phone;
  }
  tokens.parentA = await guardianLogin(ids.phoneA!);

  const h = await as('warden')
    .post('/api/v1/hst/hostels')
    .send({ campusId: ids.dhn, code: `M${run}`.slice(0, 20), name: `Mess Hostel ${run}`, gender: 'boys' });
  expect(h.status, JSON.stringify(h.body)).toBe(201);
  ids.hostel = h.body.data.id;
  const room = await as('warden')
    .post(`/api/v1/hst/hostels/${ids.hostel}/rooms`)
    .send({ code: 'M-1', roomType: 'dormitory', beds: 3 });
  expect(room.status, JSON.stringify(room.body)).toBe(201);
  const occ = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/occupancy?date=${DAY}`);
  const beds = occ.body.data.rooms[0].beds.map((b: { bedId: string }) => b.bedId);
  for (const [i, k, plan] of [
    [0, 'A', 'full'],
    [1, 'B', 'none'],
    [2, 'C', 'full'],
  ] as const) {
    const a = await as('warden')
      .post('/api/v1/hst/allocations')
      .send({ studentId: ids[`s${k}`], bedId: beds[i], validFrom: '2095-02-01', mealPlan: plan });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    ids[`alloc${k}`] = a.body.data.id;
  }
  // C goes home for the evening: an approved out-pass covering dinner
  await t.owner.query(
    `INSERT INTO hst.outpass (org_id, campus_id, hostel_id, student_id, kind, destination, out_from, return_by, requested_by_type, status)
     VALUES ($1, $2, $3, $4, 'day_out', 'Home', $5, $6, 'staff', 'approved')`,
    [orgId, ids.dhn, ids.hostel, ids.sC, at('16:00'), at('22:00')],
  );
});

afterAll(async () => {
  await t.close();
});

describe('hostel mess', () => {
  it('weekly menu and resident diets', async () => {
    const dow = LocalDate.parse(DAY).dayOfWeek();
    const menu = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/menu`)
      .send({
        entries: [
          { dayOfWeek: dow, meal: 'breakfast', items: 'Paratha, egg, tea', itemsBn: 'পরোটা, ডিম, চা' },
          { dayOfWeek: dow, meal: 'lunch', items: 'Rice, dal, chicken curry' },
          { dayOfWeek: dow, meal: 'dinner', items: 'Rice, fish, vegetables' },
        ],
      });
    expect(menu.status, JSON.stringify(menu.body)).toBe(200);
    expect(
      (
        await as('warden')
          .put(`/api/v1/hst/hostels/${ids.hostel}/menu`)
          .send({
            entries: [
              { dayOfWeek: 1, meal: 'lunch', items: 'x' },
              { dayOfWeek: 1, meal: 'lunch', items: 'y' },
            ],
          })
      ).body.code,
    ).toBe('DUPLICATE_ENTRY');
    const diet = await as('warden').patch(`/api/v1/hst/allocations/${ids.allocA}/diet`).send({ diet: 'no_beef' });
    expect(diet.status, JSON.stringify(diet.body)).toBe(200);
  });

  it('guardian skips lunch before the cutoff; not after it; the warden still can', async () => {
    const ok = await as('parentA')
      .post(`/api/v1/hst/students/${ids.sA}/meal-opt-outs`)
      .send({ entries: [{ date: DAY, meal: 'dinner' }], reason: 'Family dinner' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.added).toBe(1);
    const late = await as('parentA')
      .post(`/api/v1/hst/students/${ids.sA}/meal-opt-outs`)
      .send({ entries: [{ date: DAY, meal: 'lunch' }] }); // 13:30, cutoff 4 h -> closed at 09:30
    expect(late.body.code).toBe('MEAL_CUTOFF_PASSED');
    const noPlan = await as('warden')
      .post(`/api/v1/hst/students/${ids.sB}/meal-opt-outs`)
      .send({ entries: [{ date: DAY, meal: 'dinner' }] });
    expect(noPlan.body.code).toBe('NO_MEAL_PLAN');
    expect(
      (
        await as('parentA')
          .post(`/api/v1/hst/students/${ids.sC}/meal-opt-outs`)
          .send({ entries: [{ date: DAY, meal: 'dinner' }] })
      ).status,
    ).toBe(404);
    const warden = await as('warden')
      .post(`/api/v1/hst/students/${ids.sC}/meal-opt-outs`)
      .send({ entries: [{ date: DAY, meal: 'lunch' }], reason: 'Exam trip' });
    expect(warden.status, JSON.stringify(warden.body)).toBe(201);

    const view = await as('parentA').get(`/api/v1/hst/students/${ids.sA}/meals`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.data).toMatchObject({ hostelId: ids.hostel, mealPlan: 'full' });
    expect(view.body.data.optOuts.map((o: { meal: string }) => o.meal)).toEqual(['dinner']);
    expect(view.body.data.menu.length).toBe(3);
  });

  it('kitchen headcount: plan, away on out-pass, opted out, diets; servings and month report', async () => {
    const day = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/meals?date=${DAY}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    const meals = day.body.data.meals as Array<{ meal: string }>;
    expect(meal(meals, 'breakfast')).toMatchObject({
      residents: 3,
      onMealPlan: 2,
      expected: 2,
      diets: { no_beef: 1, regular: 1 },
    });
    expect(meal(meals, 'lunch')).toMatchObject({ onMealPlan: 2, optedOut: 1, expected: 1 });
    expect(meal(meals, 'dinner')).toMatchObject({ away: 1, optedOut: 1, expected: 0 });
    expect(day.body.data.menu.map((m: { meal: string }) => m.meal).sort()).toEqual(['breakfast', 'dinner', 'lunch']);

    const early = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/meals/service`)
      .send({ date: DAY, meal: 'dinner', served: 1 });
    expect(early.body.code).toBe('MEAL_NOT_SERVED_YET');
    const served = await as('warden')
      .put(`/api/v1/hst/hostels/${ids.hostel}/meals/service`)
      .send({ date: DAY, meal: 'breakfast', served: 3, note: 'One guest' });
    expect(served.body.data).toEqual({ expected: 2, served: 3, difference: 1 });

    const report = await as('warden').get(`/api/v1/hst/hostels/${ids.hostel}/meals/report?month=2095-02`);
    expect(report.body.data.totals).toEqual({ expected: 2, served: 3 });
    expect(report.body.data.skippedByStudent.map((s: { skipped: number }) => s.skipped)).toEqual([1, 1]);

    const back = await as('parentA').del(`/api/v1/hst/students/${ids.sA}/meal-opt-outs/${DAY}/dinner`);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.data.removed).toBe(true);
  });
});
