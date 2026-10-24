/**
 * End-to-end through HTTP: CORE -> HRM -> ACA -> SIS -> ATT -> COM, each step done by the role that owns it.
 * Uses a fixed clock in a dedicated test year (2091) so school-day / edit-window rules are deterministic.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { LocalDate } from '../../src/shared/domain/LocalDate.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const YEAR_CODE = 'TEST-2091';

// first Sunday-Thursday in March 2091 (Bangladesh week: Sat-Thu, Friday off)
let SCHOOL_DAY = LocalDate.parse('2091-03-01');
while (![0, 1, 2, 3, 4].includes(SCHOOL_DAY.dayOfWeek())) SCHOOL_DAY = SCHOOL_DAY.addDays(1);
let FRIDAY = LocalDate.parse('2091-03-01');
while (FRIDAY.dayOfWeek() !== 5) FRIDAY = FRIDAY.addDays(1);

const clock = new FixedClock(new Date(`${SCHOOL_DAY.iso}T03:00:00Z`)); // 09:00 in Dhaka
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
  patch: (url: string) => request(t.app).patch(url).set('Authorization', `Bearer ${tokens[who]}`),
});

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
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

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const guardian = (phone: string, over: Record<string, unknown> = {}) => ({
  fullNameEn: 'Test Guardian',
  phone,
  relationship: 'father',
  preferredLocale: 'en',
  ...over,
});

const studentBody = (first: string, over: Record<string, unknown> = {}) => ({
  firstNameEn: first,
  lastNameEn: 'Tester',
  gender: 'male',
  dateOfBirth: '2079-05-01',
  admittedOn: SCHOOL_DAY.iso,
  ...over,
});

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  ids.gul = await t.owner.campusId('GUL');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, $2, '2091-01-01', '2091-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId, YEAR_CODE],
  );
  ids.year = year!.id;
  const [y7] = await t.owner.query<{ id: string }>(
    `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = 'Y7'`,
    [orgId],
  );
  ids.y7 = y7!.id;

  const coord = await t.owner.createStaffUser({
    password: PASSWORD,
    roleCode: 'ACADEMIC_COORDINATOR',
    campusCode: 'DHN',
  });
  const hr = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'HR' });
  const it = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'IT_ADMIN' });
  tokens.coord = await login(coord.username);
  tokens.hr = await login(hr.username);
  tokens.it = await login(it.username);
});

afterAll(async () => {
  await t.close();
});

describe('academic set-up (CORE, HRM, ACA)', () => {
  it('IT admin sees the calendar: school day vs Friday', async () => {
    const day = await as('it').get(`/api/v1/core/today?campusId=${ids.dhn}&date=${SCHOOL_DAY.iso}`);
    expect(day.status).toBe(200);
    expect(day.body.data).toMatchObject({ schoolDay: true, year: { code: YEAR_CODE } });
    const fri = await as('it').get(`/api/v1/core/today?campusId=${ids.dhn}&date=${FRIDAY.iso}`);
    expect(fri.body.data).toMatchObject({ schoolDay: false, reason: 'weekend' });
  });

  it('HR creates a teacher; IT admin gives them a class-teacher login', async () => {
    const staff = await as('hr')
      .post('/api/v1/hrm/staff')
      .send({
        campusId: ids.dhn,
        staffNo: `T-${run}`,
        fullNameEn: 'Nusrat Teacher',
        gender: 'female',
        phone: '+8801811111111',
        email: `teacher.${run}@test.local`,
        staffType: 'teaching',
        joinedOn: '2090-01-01',
        nid: '1990 1234 5678',
      });
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    expect(staff.body.data.hasNid).toBe(true);
    expect(JSON.stringify(staff.body)).not.toContain('1990');
    ids.teacherStaff = staff.body.data.id;

    const byNid = await as('hr').get('/api/v1/hrm/staff?nid=199012345678');
    expect(byNid.body.data.map((s: { id: string }) => s.id)).toContain(ids.teacherStaff);

    const account = await as('it')
      .post(`/api/v1/hrm/staff/${ids.teacherStaff}/account`)
      .send({
        username: `teacher.${run}`,
        password: PASSWORD,
        roleCode: 'CLASS_TEACHER',
        campusId: ids.dhn,
      });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    tokens.teacher = await login(`teacher.${run}`);
  });

  it('coordinator builds subject, section, curriculum and teaching groups', async () => {
    const subject = await as('coord')
      .post('/api/v1/aca/subjects')
      .send({ code: `MATH${run}`, nameEn: 'Mathematics', kind: 'core' });
    expect(subject.status, JSON.stringify(subject.body)).toBe(201);
    const section = await as('coord')
      .post('/api/v1/aca/sections')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y7,
        name: `A${run}`,
        displayName: `Year 7 - A (${run})`,
        capacity: 3,
        classTeacherStaffId: ids.teacherStaff,
      });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    ids.section = section.body.data.id;
    const other = await as('coord')
      .post('/api/v1/aca/sections')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y7,
        name: `B${run}`,
        displayName: `Year 7 - B (${run})`,
        capacity: 30,
      });
    ids.otherSection = other.body.data.id;

    const curriculum = await as('coord')
      .post('/api/v1/aca/curriculum')
      .send({ academicYearId: ids.year, yearGroupId: ids.y7, subjectId: subject.body.data.id, periodsPerWeek: 6 });
    expect([201, 409]).toContain(curriculum.status);
    const gen = await as('coord').post(`/api/v1/aca/sections/${ids.section}/generate-teaching-groups`).send();
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.data.created).toBeGreaterThanOrEqual(1);
    const again = await as('coord').post(`/api/v1/aca/sections/${ids.section}/generate-teaching-groups`).send();
    expect(again.body.data.created).toBe(0); // idempotent
  });

  it('campus scope: DHN coordinator cannot create a Gulshan section', async () => {
    const res = await as('coord').post('/api/v1/aca/sections').send({
      campusId: ids.gul,
      academicYearId: ids.year,
      yearGroupId: ids.y7,
      name: 'X',
      displayName: 'X',
      capacity: 10,
    });
    expect(res.status).toBe(403);
  });
});

describe('students (SIS)', () => {
  const p1 = `+88017${String(Date.now()).slice(-8)}`;
  const p2 = `+88016${String(Date.now()).slice(-8)}`;

  it('registers a student with guardian, family, encrypted birth certificate and enrolment', async () => {
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: studentBody('Ayaan', { birthCertNo: `2079${run}0001`, fullNameBn: 'আয়ান' }),
        guardians: [guardian(p1, { isPrimaryContact: true, isFeePayer: true })],
        enrolment: { classSectionId: ids.section },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const d = res.body.data;
    expect(d.student.admissionNo).toMatch(/^DHN-\d{4}-\d{4}$/);
    expect(d.student.hasBirthCert).toBe(true);
    expect(JSON.stringify(d)).not.toContain(`2079${run}0001`);
    expect(d.enrolment).toMatchObject({ classSectionId: ids.section, rollNo: 1 });
    expect(d.guardians[0]).toMatchObject({ isPrimaryContact: true, isFeePayer: true });
    expect(d.siblingFamily).toBe(false);
    ids.studentA = d.student.id;
    ids.familyA = d.student.familyId;
  });

  it('a sibling (same guardian phone) joins the same family', async () => {
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: studentBody('Zara', { gender: 'female' }),
        guardians: [guardian(p1)],
        enrolment: { classSectionId: ids.section },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.siblingFamily).toBe(true);
    expect(res.body.data.student.familyId).toBe(ids.familyA);
    expect(res.body.data.enrolment.rollNo).toBe(2);
    ids.studentB = res.body.data.student.id;
  });

  it('duplicate birth certificate is refused; full section is refused', async () => {
    const dup = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: studentBody('Dup', { birthCertNo: `2079-${run}-0001` }),
        guardians: [guardian(p2)],
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');

    const c = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: studentBody('Rafi'),
        guardians: [guardian(p2, { relationship: 'mother' })],
        enrolment: { classSectionId: ids.section },
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    ids.studentC = c.body.data.student.id;

    const d = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: studentBody('Overflow'),
        guardians: [guardian(`+88015${String(Date.now()).slice(-8)}`)],
        enrolment: { classSectionId: ids.section },
      });
    expect(d.status).toBe(409);
    expect(d.body.code).toBe('SECTION_FULL');
  });

  it('student 360 and roster', async () => {
    const s360 = await as('coord').get(`/api/v1/sis/students/${ids.studentA}`);
    expect(s360.status).toBe(200);
    expect(s360.body.data.enrolmentHistory).toHaveLength(1);
    const roster = await as('coord').get(`/api/v1/sis/sections/${ids.section}/roster?date=${SCHOOL_DAY.iso}`);
    expect(roster.body.data.map((r: { rollNo: number }) => r.rollNo)).toEqual([1, 2, 3]);
  });

  it("class teacher only finds own class's students", async () => {
    const mine = await as('teacher').get(`/api/v1/sis/students?q=tester`);
    expect(mine.status).toBe(200);
    const found = mine.body.data.map((s: { id: string }) => s.id);
    expect(found).toEqual(expect.arrayContaining([ids.studentA, ids.studentB, ids.studentC]));
    const other = await as('teacher').get(`/api/v1/sis/sections/${ids.otherSection}/roster`);
    expect(other.status).toBe(403);
  });
});

describe('attendance (ATT -> COM)', () => {
  it('teacher marks the register; absent/late alert guardians once', async () => {
    const sheet = await as('teacher').get(`/api/v1/att/sections/${ids.section}/daily?date=${SCHOOL_DAY.iso}`);
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
    expect(sheet.body.data).toMatchObject({ schoolDay: true, marked: false });
    expect(sheet.body.data.entries).toHaveLength(3);

    const entries = [
      { studentId: ids.studentA, status: 'absent' },
      { studentId: ids.studentB, status: 'present' },
      { studentId: ids.studentC, status: 'late', arrivedAt: `${SCHOOL_DAY.iso}T02:50:00Z` },
    ];
    const mark = await as('teacher')
      .put(`/api/v1/att/sections/${ids.section}/daily?date=${SCHOOL_DAY.iso}`)
      .send({ entries });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    expect(mark.body.data).toMatchObject({ absent: 1, late: 1, present: 1, changed: 3, alerts: 2 });

    await drainOutbox();
    // a running dev worker may deliver first (same database); either way the messages must appear exactly once
    const sms = await eventually(
      () =>
        t.owner.query<{ event_code: string; body: string }>(
          `SELECT event_code, body FROM com.outbound_message WHERE dedupe_key IN ($1, $2) AND channel = 'sms' ORDER BY event_code`,
          [`att.absent:${ids.studentA}:${SCHOOL_DAY.iso}`, `att.late:${ids.studentC}:${SCHOOL_DAY.iso}`],
        ),
      (rows) => rows.length >= 2,
    );
    expect(sms.map((m) => m.event_code)).toEqual(['att.absent', 'att.late']);
    expect(sms[0]!.body).toContain('Ayaan');

    const again = await as('teacher')
      .put(`/api/v1/att/sections/${ids.section}/daily?date=${SCHOOL_DAY.iso}`)
      .send({ entries });
    expect(again.body.data).toMatchObject({ changed: 0, alerts: 0 });
  });

  it('rules: no marking on Friday, other sections out of scope', async () => {
    clock.set(new Date(`${FRIDAY.iso}T03:00:00Z`));
    try {
      const fri = await as('teacher')
        .put(`/api/v1/att/sections/${ids.section}/daily?date=${FRIDAY.iso}`)
        .send({ entries: [{ studentId: ids.studentA, status: 'present' }] });
      expect(fri.body.code).toBe('NOT_A_SCHOOL_DAY');
    } finally {
      clock.set(new Date(`${SCHOOL_DAY.iso}T03:00:00Z`));
    }
    const other = await as('teacher').get(`/api/v1/att/sections/${ids.otherSection}/daily?date=${SCHOOL_DAY.iso}`);
    expect(other.status).toBe(403);
    const past = await as('teacher')
      .put(`/api/v1/att/sections/${ids.section}/daily?date=2091-01-05`)
      .send({ entries: [{ studentId: ids.studentA, status: 'present' }] });
    expect(past.body.code).toBe('ATTENDANCE_EDIT_WINDOW_CLOSED');
  });

  it('leave: coordinator applies, class teacher approves -> school days marked leave', async () => {
    const from = SCHOOL_DAY.addDays(1);
    const to = SCHOOL_DAY.addDays(3);
    const apply = await as('coord')
      .post('/api/v1/att/student-leaves')
      .send({ studentId: ids.studentB, fromDate: from.iso, toDate: to.iso, reasonCode: 'illness' });
    expect(apply.status, JSON.stringify(apply.body)).toBe(201);
    const overlap = await as('coord')
      .post('/api/v1/att/student-leaves')
      .send({ studentId: ids.studentB, fromDate: to.iso, toDate: to.iso, reasonCode: 'illness' });
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');

    const decide = await as('teacher')
      .post(`/api/v1/att/student-leaves/${apply.body.data.id}/decide`)
      .send({ decision: 'approved' });
    expect(decide.status, JSON.stringify(decide.body)).toBe(200);
    let expected = 0;
    for (let d = from; !d.isAfter(to); d = d.addDays(1)) if ([6, 0, 1, 2, 3, 4].includes(d.dayOfWeek())) expected++;
    expect(decide.body.data.daysMarked).toBe(expected);

    const summary = await as('teacher').get(
      `/api/v1/att/students/${ids.studentA}/summary?from=2091-01-01&to=2091-12-31`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ absent: 1, countedDays: 1, percent: 0 });
  });
});
