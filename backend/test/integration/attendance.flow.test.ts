/**
 * Daily and period-wise attendance end-to-end: quick marking (exceptions only), the teacher's day, lesson registers
 * from the timetable (cover teacher, elective groups, senior years only), guardian alert for a missed lesson,
 * edits inside the window (audited), corrections after it (maker-checker) and the mark history.
 * Fixed clock in a dedicated test year (2092).
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
const YEAR_CODE = 'TEST-2092';

// a Sunday-Wednesday in March 2092, so the next day is a school day too (Bangladesh week: Sat-Thu)
let DAY = LocalDate.parse('2092-03-01');
while (![0, 1, 2, 3].includes(DAY.dayOfWeek())) DAY = DAY.addDays(1);
const NEXT = DAY.addDays(1);
const at = (d: LocalDate, hhmm: string) => new Date(`${d.iso}T${hhmm}:00+06:00`);

const clock = new FixedClock(at(DAY, '09:00'));
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const users: Record<string, string> = {};

const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
  put: (url: string) =>
    request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
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
  return new OutboxRelay({
    db,
    pool,
    eventBus: t.container.resolve<EventBus>('eventBus'),
    subscriptions: t.container.resolve<SubscriptionRegistry>('subscriptions'),
    logger,
    metrics,
  }).drain();
}

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function teacher(name: string, roleCode: string): Promise<void> {
  const staff = await as('hr')
    .post('/api/v1/hrm/staff')
    .send({
      campusId: ids.dhn,
      staffNo: `AT-${name}-${run}`,
      fullNameEn: `${name} Teacher`,
      gender: 'female',
      phone: `+88019${String(Date.now()).slice(-8)}`,
      email: `${name}.${run}@test.local`,
      staffType: 'teaching',
      joinedOn: '2090-01-01',
    });
  expect(staff.status, JSON.stringify(staff.body)).toBe(201);
  ids[`staff_${name}`] = staff.body.data.id;
  const account = await as('it')
    .post(`/api/v1/hrm/staff/${staff.body.data.id}/account`)
    .send({ username: `${name}.${run}`, password: PASSWORD, roleCode, campusId: ids.dhn });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  users[name] = account.body.data.id ?? account.body.data.userId;
  tokens[name] = await login(`${name}.${run}`);
}

async function student(name: string, sectionId: string): Promise<{ studentId: string; enrolmentId: string }> {
  const res = await as('coord')
    .post('/api/v1/sis/students')
    .send({
      campusId: ids.dhn,
      student: {
        firstNameEn: name,
        lastNameEn: 'Rahman',
        gender: 'male',
        dateOfBirth: '2078-05-01',
        admittedOn: DAY.iso,
      },
      guardians: [
        {
          fullNameEn: `${name} Guardian`,
          phone: `+88017${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`,
          relationship: 'father',
          preferredLocale: 'en',
          isPrimaryContact: true,
          isFeePayer: true,
        },
      ],
      enrolment: { classSectionId: sectionId },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { studentId: res.body.data.student.id, enrolmentId: res.body.data.enrolment.id };
}

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, $2, '2092-01-01', '2092-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId, YEAR_CODE],
  );
  ids.year = year!.id;
  // earlier runs published timetables for this year: retire them
  await t.owner.query(`UPDATE aca.timetable SET status = 'archived' WHERE academic_year_id = $1`, [ids.year]);
  for (const code of ['Y10', 'Y7']) {
    const [y] = await t.owner.query<{ id: string }>(
      `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = $2`,
      [orgId, code],
    );
    ids[code] = y!.id;
  }
  const [shift] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.shift (org_id, campus_id, code, name_en, starts_at, ends_at) VALUES ($1, $2, $3, 'Test shift', '07:30', '14:00') RETURNING id`,
    [orgId, ids.dhn, `ATT${run}`],
  );
  ids.shift = shift!.id;

  const coord = await t.owner.createStaffUser({
    password: PASSWORD,
    roleCode: 'ACADEMIC_COORDINATOR',
    campusCode: 'DHN',
  });
  users.coord = coord.id;
  tokens.coord = await login(coord.username);
  tokens.hr = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'HR' })).username);
  tokens.it = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'IT_ADMIN' })).username);
  await teacher('classt', 'CLASS_TEACHER');
  await teacher('subjt', 'SUBJECT_TEACHER');
  await teacher('covert', 'SUBJECT_TEACHER');
});

afterAll(async () => {
  await t.close();
});

describe('set-up: sections, groups, bell schedule, timetable with cover', () => {
  it('coordinator builds Y10 (period-wise) and Y7 (daily only)', async () => {
    const subject = await as('coord')
      .post('/api/v1/aca/subjects')
      .send({ code: `PHY${run}`, nameEn: 'Physics', kind: 'core' });
    expect(subject.status, JSON.stringify(subject.body)).toBe(201);
    ids.subject = subject.body.data.id;
    const section = async (yg: string, name: string, classTeacher?: string) => {
      const res = await as('coord')
        .post('/api/v1/aca/sections')
        .send({
          campusId: ids.dhn,
          academicYearId: ids.year,
          yearGroupId: ids[yg],
          name: `${name}${run}`,
          displayName: `${yg} - ${name} (${run})`,
          capacity: 30,
          ...(classTeacher ? { classTeacherStaffId: classTeacher } : {}),
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.y10 = await section('Y10', 'A', ids.staff_classt);
    ids.y7 = await section('Y7', 'B');

    for (const [k, n] of [
      ['a', 'Arif'],
      ['b', 'Badal'],
      ['c', 'Chayan'],
    ] as const) {
      const s = await student(n, ids.y10);
      ids[k] = s.studentId;
      ids[`enr_${k}`] = s.enrolmentId;
    }
    ids.d = (await student('Dipu', ids.y7)).studentId;

    const group = async (body: Record<string, unknown>) => {
      const res = await as('coord')
        .post('/api/v1/aca/teaching-groups')
        .send({ campusId: ids.dhn, academicYearId: ids.year, subjectId: ids.subject, ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.g10 = await group({
      yearGroupId: ids.Y10,
      name: `Y10 Physics ${run}`,
      membership: 'whole_section',
      classSectionId: ids.y10,
    });
    ids.gElective = await group({ yearGroupId: ids.Y10, name: `Y10 Further Maths ${run}`, membership: 'explicit' });
    ids.g7 = await group({
      yearGroupId: ids.Y7,
      name: `Y7 Science ${run}`,
      membership: 'whole_section',
      classSectionId: ids.y7,
    });
    const members = await as('coord')
      .put(`/api/v1/aca/teaching-groups/${ids.gElective}/members`)
      .send({ enrolmentIds: [ids.enr_a, ids.enr_b], onDate: DAY.iso });
    expect(members.status, JSON.stringify(members.body)).toBe(200);

    const period = async (periodNo: number, label: string, kind: string, startsAt: string, endsAt: string) => {
      const res = await as('coord')
        .post('/api/v1/aca/periods')
        .send({ campusId: ids.dhn, shiftId: ids.shift, periodNo, label, kind, startsAt, endsAt });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.p1 = await period(1, 'P1', 'teaching', '08:00', '08:45');
    ids.p2 = await period(2, 'P2', 'teaching', '08:50', '09:35');
    ids.p3 = await period(3, 'P3', 'teaching', '13:00', '13:45');

    const tt = await as('coord')
      .post('/api/v1/aca/timetables')
      .send({ campusId: ids.dhn, academicYearId: ids.year, name: `Term ${run}`, effectiveFrom: '2092-01-01' });
    expect(tt.status, JSON.stringify(tt.body)).toBe(201);
    const dow = DAY.dayOfWeek();
    const slots = await as('coord')
      .put(`/api/v1/aca/timetables/${tt.body.data.id}/slots`)
      .send({
        slots: [
          { dayOfWeek: dow, periodDefinitionId: ids.p1, teachingGroupId: ids.g10, staffId: ids.staff_subjt },
          { dayOfWeek: dow, periodDefinitionId: ids.p2, teachingGroupId: ids.gElective, staffId: ids.staff_subjt },
          { dayOfWeek: dow, periodDefinitionId: ids.p3, teachingGroupId: ids.g10, staffId: ids.staff_subjt },
          { dayOfWeek: dow, periodDefinitionId: ids.p1, teachingGroupId: ids.g7, staffId: ids.staff_covert },
        ],
      });
    expect(slots.status, JSON.stringify(slots.body)).toBe(200);
    expect((await as('coord').post(`/api/v1/aca/timetables/${tt.body.data.id}/publish`).send()).status).toBe(200);

    // the physics teacher is away for P3: the cover teacher takes it
    await t.owner.query(
      `INSERT INTO aca.substitution (org_id, campus_id, cover_date, timetable_slot_id, absent_staff_id, cover_staff_id, status)
       SELECT $1, $2, $3, s.id, $4, $5, 'assigned' FROM aca.timetable_slot s
        WHERE s.timetable_id = $6 AND s.period_definition_id = $7`,
      [await t.owner.orgId(), ids.dhn, DAY.iso, ids.staff_subjt, ids.staff_covert, tt.body.data.id, ids.p3],
    );
  });
});

describe('daily register: under a minute per class', () => {
  it('class teacher sends only the exception; everyone else is present', async () => {
    const sheet = await as('classt').get(`/api/v1/att/sections/${ids.y10}/daily?date=${DAY.iso}`);
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
    expect(sheet.body.data).toMatchObject({ editable: true, periodWise: true, marked: false });
    expect(sheet.body.data.editableUntil).toBe(at(NEXT, '12:00').toISOString());

    const mark = await as('classt')
      .put(`/api/v1/att/sections/${ids.y10}/daily?date=${DAY.iso}`)
      .send({ markRest: true, entries: [{ studentId: ids.c, status: 'absent' }] });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    expect(mark.body.data).toMatchObject({ present: 2, absent: 1, changed: 3, alerts: 1 });
    const empty = await as('classt').put(`/api/v1/att/sections/${ids.y10}/daily?date=${DAY.iso}`).send({ entries: [] });
    expect(empty.body.code).toBe('NO_ENTRIES');
  });

  it("teacher's day lists registers and lessons (cover replaces the timetabled teacher; daily-only years skipped)", async () => {
    const ct = await as('classt').get(`/api/v1/att/my-registers?date=${DAY.iso}`);
    expect(ct.status, JSON.stringify(ct.body)).toBe(200);
    expect(ct.body.data.daily).toEqual([
      expect.objectContaining({ classSectionId: ids.y10, students: 3, marked: 3, editable: true }),
    ]);

    const st = await as('subjt').get(`/api/v1/att/my-registers?date=${DAY.iso}`);
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body.data.periods.map((p: { label: string }) => p.label)).toEqual(['P1', 'P2']);
    expect(st.body.data.periods[1]).toMatchObject({ teachingGroupId: ids.gElective, students: 2, marked: 0 });

    const cv = await as('covert').get(`/api/v1/att/my-registers?date=${DAY.iso}`);
    expect(cv.body.data.periods).toEqual([expect.objectContaining({ label: 'P3', cover: true, students: 3 })]);
  });
});

describe('period-wise register', () => {
  it('pre-filled from the day; exceptions only; missing a lesson while at school alerts the guardian', async () => {
    const reg = await as('subjt').get(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p1}?date=${DAY.iso}`);
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const suggested = Object.fromEntries(
      reg.body.data.entries.map((e: { studentId: string; suggested: string }) => [e.studentId, e.suggested]),
    );
    expect(suggested).toEqual({ [ids.a!]: 'present', [ids.b!]: 'present', [ids.c!]: 'absent' });
    expect(reg.body.data).toMatchObject({ periodWise: true, editable: true, period: { label: 'P1' } });

    const mark = await as('subjt')
      .put(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p1}?date=${DAY.iso}`)
      .send({ markRest: true, entries: [{ studentId: ids.b, status: 'absent' }] });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    expect(mark.body.data).toMatchObject({ present: 1, absent: 2, changed: 3, alerts: 1 });

    await drainOutbox();
    const sms = await eventually(
      () =>
        t.owner.query<{ body: string }>(
          `SELECT body FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
          [`att.period_missed:${ids.b}:${DAY.iso}:${ids.p1}`],
        ),
      (rows) => rows.length >= 1,
    );
    expect(sms).toHaveLength(1);
    expect(sms[0]!.body).toContain('Badal');
    expect(sms[0]!.body).toContain('P1');
  });

  it('rules: elective roster, not scheduled, not started, cover only, daily-only years', async () => {
    const elective = await as('subjt')
      .put(`/api/v1/att/teaching-groups/${ids.gElective}/periods/${ids.p2}?date=${DAY.iso}`)
      .send({ entries: [{ studentId: ids.c, status: 'present' }] });
    expect(elective.body.code).toBe('STUDENT_NOT_IN_GROUP');
    const ok = await as('subjt')
      .put(`/api/v1/att/teaching-groups/${ids.gElective}/periods/${ids.p2}?date=${DAY.iso}`)
      .send({ markRest: true });
    expect(ok.body.data).toMatchObject({ present: 2, changed: 2 });

    const unscheduled = await as('subjt').get(
      `/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p2}?date=${DAY.iso}`,
    );
    expect(unscheduled.body.code).toBe('NOT_SCHEDULED');

    const early = await as('covert')
      .put(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p3}?date=${DAY.iso}`)
      .send({ markRest: true });
    expect(early.body.code).toBe('PERIOD_NOT_STARTED');

    clock.set(at(DAY, '13:10'));
    try {
      const timetabled = await as('subjt')
        .put(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p3}?date=${DAY.iso}`)
        .send({ markRest: true });
      expect(timetabled.status).toBe(403);
      const cover = await as('covert')
        .put(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p3}?date=${DAY.iso}`)
        .send({ markRest: true });
      expect(cover.status, JSON.stringify(cover.body)).toBe(200);
      expect(cover.body.data).toMatchObject({ present: 2, absent: 1, alerts: 0 });

      const y7 = await as('covert')
        .put(`/api/v1/att/teaching-groups/${ids.g7}/periods/${ids.p1}?date=${DAY.iso}`)
        .send({ markRest: true });
      expect(y7.body.code).toBe('PERIOD_WISE_NOT_ENABLED');
    } finally {
      clock.set(at(DAY, '09:00'));
    }
  });

  it('class teacher sees the whole day per student, with missed lessons', async () => {
    const day = await as('classt').get(`/api/v1/att/sections/${ids.y10}/day?date=${DAY.iso}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(day.body.data.periods.map((p: { label: string }) => p.label)).toEqual(['P1', 'P2', 'P3']);
    const b = day.body.data.students.find((s: { studentId: string }) => s.studentId === ids.b);
    expect(b).toMatchObject({ daily: 'present', missedPeriods: 1 });
    expect(b.periods[ids.p1!].status).toBe('absent');
  });

  it('an edit inside the window is audited: who, when, from what to what', async () => {
    const fix = await as('subjt')
      .put(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p1}?date=${DAY.iso}`)
      .send({ entries: [{ studentId: ids.b, status: 'late' }] });
    expect(fix.body.data).toMatchObject({ changed: 1, alerts: 0 });
    const history = await as('classt').get(`/api/v1/att/students/${ids.b}/history?date=${DAY.iso}`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(history.body.data.changes).toEqual([
      expect.objectContaining({
        register: 'period',
        periodDefinitionId: ids.p1,
        action: 'UPDATE',
        from: 'absent',
        to: 'late',
        source: 'correction',
        by: users.subjt,
      }),
    ]);
  });
});

describe('after the edit window: corrections (maker-checker)', () => {
  it('register is closed the next afternoon; the teacher asks, someone else approves, history shows it', async () => {
    clock.set(at(NEXT, '13:00'));
    try {
      const closed = await as('classt')
        .put(`/api/v1/att/sections/${ids.y10}/daily?date=${DAY.iso}`)
        .send({ entries: [{ studentId: ids.c, status: 'present' }] });
      expect(closed.body.code).toBe('ATTENDANCE_EDIT_WINDOW_CLOSED');
      const sheet = await as('classt').get(`/api/v1/att/sections/${ids.y10}/daily?date=${DAY.iso}`);
      expect(sheet.body.data.editable).toBe(false);

      const open = await as('classt')
        .post('/api/v1/att/corrections')
        .send({ kind: 'daily', studentId: ids.c, date: NEXT.iso, newStatus: 'present', reason: 'Register not taken' });
      expect(open.body.code).toBe('EDIT_WINDOW_OPEN');

      const req = await as('classt').post('/api/v1/att/corrections').send({
        kind: 'daily',
        studentId: ids.c,
        date: DAY.iso,
        newStatus: 'late',
        reason: 'Arrived 08:40 with a dentist note, office confirmed',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect(req.body.data).toMatchObject({ status: 'pending', oldStatus: 'absent', newStatus: 'late' });
      const dup = await as('classt')
        .post('/api/v1/att/corrections')
        .send({ kind: 'daily', studentId: ids.c, date: DAY.iso, newStatus: 'present', reason: 'Second request here' });
      expect(dup.status).toBe(409);
      expect(
        (await as('classt').post(`/api/v1/att/corrections/${req.body.data.id}/decide`).send({ decision: 'approved' }))
          .status,
      ).toBe(403);

      const queue = await as('coord').get('/api/v1/att/corrections?status=pending');
      expect(queue.body.data.map((c: { id: string }) => c.id)).toContain(req.body.data.id);
      const mine = await as('classt').get('/api/v1/att/corrections');
      expect(mine.body.data.every((c: { requestedBy: string }) => c.requestedBy === users.classt)).toBe(true);

      const ok = await as('coord')
        .post(`/api/v1/att/corrections/${req.body.data.id}/decide`)
        .send({ decision: 'approved', note: 'Note seen' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toMatchObject({ status: 'approved', decidedBy: users.coord });
      await drainOutbox();
      const told = await eventually(
        () =>
          t.owner.query<{ channel: string; body: string }>(
            `SELECT channel, body FROM com.outbound_message WHERE dedupe_key = $1`,
            [`att.correction_decided:${req.body.data.id}:approved`],
          ),
        (rows) => rows.length > 0,
      );
      expect(told.map((m) => m.channel)).toContain('in_app');

      const history = await as('coord').get(`/api/v1/att/students/${ids.c}/history?date=${DAY.iso}`);
      expect(history.body.data.daily.status).toBe('late');
      expect(history.body.data.changes).toContainEqual(
        expect.objectContaining({
          register: 'daily',
          from: 'absent',
          to: 'late',
          source: 'correction',
          by: users.coord,
        }),
      );
      expect(history.body.data.corrections[0]).toMatchObject({ status: 'approved', requestedBy: users.classt });
    } finally {
      clock.set(at(DAY, '09:00'));
    }
  });

  it('lesson corrections: never self-approved; rejected and withdrawn requests change nothing', async () => {
    clock.set(at(NEXT, '13:00'));
    try {
      const own = await as('coord').post('/api/v1/att/corrections').send({
        kind: 'period',
        studentId: ids.a,
        date: DAY.iso,
        periodDefinitionId: ids.p1,
        newStatus: 'late',
        reason: 'Came in after the bell',
      });
      expect(own.status, JSON.stringify(own.body)).toBe(201);
      const self = await as('coord')
        .post(`/api/v1/att/corrections/${own.body.data.id}/decide`)
        .send({ decision: 'approved' });
      expect(self.body.code).toBe('SELF_APPROVAL');
      expect(
        (await as('coord').post(`/api/v1/att/corrections/${own.body.data.id}/cancel`).send()).body.data.status,
      ).toBe('cancelled');

      const bad = await as('subjt').post('/api/v1/att/corrections').send({
        kind: 'period',
        studentId: ids.a,
        date: DAY.iso,
        periodDefinitionId: ids.p1,
        newStatus: 'leave',
        reason: 'Wrong status kind',
      });
      expect(bad.body.code).toBe('STATUS_INVALID');
      const req = await as('subjt').post('/api/v1/att/corrections').send({
        kind: 'period',
        studentId: ids.a,
        date: DAY.iso,
        periodDefinitionId: ids.p1,
        newStatus: 'absent',
        reason: 'Was in the sick room',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      const no = await as('coord')
        .post(`/api/v1/att/corrections/${req.body.data.id}/decide`)
        .send({ decision: 'rejected', note: 'Nurse log says 09:40' });
      expect(no.body.data.status).toBe('rejected');
      const reg = await as('subjt').get(`/api/v1/att/teaching-groups/${ids.g10}/periods/${ids.p1}?date=${DAY.iso}`);
      expect(reg.body.data.entries.find((e: { studentId: string }) => e.studentId === ids.a).status).toBe('present');
      expect(reg.body.data.editable).toBe(false);
    } finally {
      clock.set(at(DAY, '09:00'));
    }
  });
});
