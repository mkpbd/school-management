/**
 * ACA read models used by the web app: current teachers / members of a teaching group, ending a teacher's
 * allocation, subject groups (electives) and the grading-scheme picker list.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const YEAR_CODE = 'TEST-2092';
const ON = '2092-03-01';
const clock = new FixedClock(new Date(`${ON}T03:00:00Z`)); // 09:00 in Dhaka

let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const dhaka = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + offsetDays * 86_400_000));

const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app)
      .post(url)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}-${Date.now()}`),
  put: (url: string) => request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`),
  patch: (url: string) => request(t.app).patch(url).set('Authorization', `Bearer ${tokens[who]}`),
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
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, $2, '2092-01-01', '2092-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId, YEAR_CODE],
  );
  ids.year = year!.id;
  const [y7] = await t.owner.query<{ id: string; programmeId: string }>(
    `SELECT y.id, y.programme_id AS "programmeId" FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id
     WHERE p.org_id = $1 AND y.code = 'Y7'`,
    [orgId],
  );
  ids.y7 = y7!.id;
  ids.programme = y7!.programmeId;

  const coord = await t.owner.createStaffUser({
    password: PASSWORD,
    roleCode: 'ACADEMIC_COORDINATOR',
    campusCode: 'DHN',
  });
  const hr = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'HR' });
  tokens.coord = await login(coord.username);
  tokens.hr = await login(hr.username);

  const staff = await as('hr')
    .post('/api/v1/hrm/staff')
    .send({
      campusId: ids.dhn,
      staffNo: `TA-${run}`,
      fullNameEn: 'Allocation Teacher',
      gender: 'female',
      phone: '+8801822222222',
      staffType: 'teaching',
      joinedOn: '2090-01-01',
    });
  expect(staff.status, JSON.stringify(staff.body)).toBe(201);
  ids.teacher = staff.body.data.id;

  const subject = await as('coord')
    .post('/api/v1/aca/subjects')
    .send({ code: `PHY${run}`, nameEn: 'Physics', kind: 'elective' });
  expect(subject.status, JSON.stringify(subject.body)).toBe(201);
  ids.subject = subject.body.data.id;
});

afterAll(async () => {
  await t.close();
});

describe('teaching group teachers and members', () => {
  it('lists the allocated teacher, and ending the allocation removes them from later dates', async () => {
    const group = await as('coord')
      .post('/api/v1/aca/teaching-groups')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        subjectId: ids.subject,
        yearGroupId: ids.y7,
        name: `Physics set ${run}`,
        membership: 'explicit',
      });
    expect(group.status, JSON.stringify(group.body)).toBe(201);
    ids.group = group.body.data.id;

    const assign = await as('coord')
      .put(`/api/v1/aca/teaching-groups/${ids.group}/teachers`)
      .send({ staffId: ids.teacher, periodsPerWeek: 4 });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);

    const teachers = await as('coord').get(`/api/v1/aca/teaching-groups/${ids.group}/teachers`);
    expect(teachers.status, JSON.stringify(teachers.body)).toBe(200);
    expect(teachers.body.data).toEqual([
      expect.objectContaining({ staffId: ids.teacher, role: 'main', periodsPerWeek: 4, validTo: null }),
    ]);

    const end = await as('coord').post(`/api/v1/aca/teaching-groups/${ids.group}/teachers/${ids.teacher}/end`).send({});
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    expect(end.body.data.ended).toBe(1);

    const tomorrow = await as('coord').get(`/api/v1/aca/teaching-groups/${ids.group}/teachers?onDate=${dhaka(1)}`);
    expect(tomorrow.body.data).toEqual([]);
    const again = await as('coord')
      .post(`/api/v1/aca/teaching-groups/${ids.group}/teachers/${ids.teacher}/end`)
      .send({});
    expect(again.status).toBe(404);
  });

  it('explicit groups list their members; whole-section groups point to the roster', async () => {
    const members = await as('coord').get(`/api/v1/aca/teaching-groups/${ids.group}/members`);
    expect(members.status, JSON.stringify(members.body)).toBe(200);
    expect(members.body.data).toEqual([]);

    const section = await as('coord')
      .post('/api/v1/aca/sections')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y7,
        name: `P${run}`,
        displayName: `Year 7 - P (${run})`,
        capacity: 30,
      });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    const whole = await as('coord')
      .post('/api/v1/aca/teaching-groups')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        subjectId: ids.subject,
        yearGroupId: ids.y7,
        name: `Physics whole ${run}`,
        membership: 'whole_section',
        classSectionId: section.body.data.id,
      });
    expect(whole.status, JSON.stringify(whole.body)).toBe(201);
    const res = await as('coord').get(`/api/v1/aca/teaching-groups/${whole.body.data.id}/members`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('GROUP_IS_WHOLE_SECTION');
  });

  it('members come back with the student name and roll number', async () => {
    const section = await as('coord')
      .post('/api/v1/aca/sections')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y7,
        name: `M${run}`,
        displayName: `Year 7 - M (${run})`,
        capacity: 30,
      });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    const reg = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: 'Member',
          lastNameEn: 'Pupil',
          gender: 'female',
          dateOfBirth: '2080-05-01',
          admittedOn: ON,
        },
        guardians: [{ fullNameEn: 'Member Guardian', phone: '+8801833333333', relationship: 'mother' }],
        enrolment: { classSectionId: section.body.data.id },
      });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const roster = await as('coord').get(`/api/v1/sis/sections/${section.body.data.id}/roster?date=${ON}`);
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    const enrolmentId = roster.body.data[0].enrolmentId as string;

    const set = await as('coord')
      .put(`/api/v1/aca/teaching-groups/${ids.group}/members`)
      .send({ enrolmentIds: [enrolmentId], onDate: ON });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const members = await as('coord').get(`/api/v1/aca/teaching-groups/${ids.group}/members?onDate=${ON}`);
    expect(members.status, JSON.stringify(members.body)).toBe(200);
    expect(members.body.data).toEqual([
      expect.objectContaining({ enrolmentId, joinedOn: ON, leftOn: null, fullNameEn: 'Member Pupil', rollNo: 1 }),
    ]);
    const before = await as('coord').get(`/api/v1/aca/teaching-groups/${ids.group}/members?onDate=2092-02-01`);
    expect(before.body.data).toEqual([]);
  });

  it('unknown group is 404', async () => {
    const res = await as('coord').get('/api/v1/aca/teaching-groups/00000000-0000-7000-8000-000000000000/teachers');
    expect(res.status).toBe(404);
  });
});

describe('subject groups and grading schemes', () => {
  it('coordinator creates, finds and edits a subject group', async () => {
    const created = await as('coord')
      .post('/api/v1/aca/subject-groups')
      .send({ programmeId: ids.programme, code: `SCI${run}`, nameEn: 'Science options', minChoose: 1, maxChoose: 2 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    const list = await as('coord').get(`/api/v1/aca/subject-groups?programmeId=${ids.programme}&q=SCI${run}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((g: { id: string }) => g.id)).toContain(id);

    const patched = await as('coord').patch(`/api/v1/aca/subject-groups/${id}`).send({ maxChoose: 3 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.maxChoose).toBe(3);

    const dup = await as('coord')
      .post('/api/v1/aca/subject-groups')
      .send({ programmeId: ids.programme, code: `SCI${run}`, nameEn: 'Again' });
    expect(dup.status).toBe(409);
  });

  it('grading schemes are listed read-only', async () => {
    const list = await as('coord').get('/api/v1/aca/grading-schemes?isActive=true');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    const create = await as('coord').post('/api/v1/aca/grading-schemes').send({ code: 'X', nameEn: 'X', kind: 'band' });
    expect(create.status).toBe(404);
  });
});
