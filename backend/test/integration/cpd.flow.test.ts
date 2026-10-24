/**
 * CPD end-to-end: catalogue -> session (capacity, self-registration) -> attendance -> completion (verified hours +
 * certificate PDF) -> external training (teacher logs, HR verifies) -> hours vs target, privacy between teachers.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const START = new Date('2091-10-05T03:00:00Z');
const clock = new FixedClock(START);

let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) => request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`),
  put: (url: string) => request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`),
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

/** messages of an event for a dedupe key (a running dev worker may deliver first: poll briefly) */
async function messages(dedupeKey: string): Promise<Array<{ channel: string; body: string }>> {
  await drainOutbox();
  for (let i = 0; i < 50; i++) {
    const rows = await t.owner.query<{ channel: string; body: string }>(
      `SELECT channel, body FROM com.outbound_message WHERE dedupe_key = $1 ORDER BY channel`,
      [dedupeKey],
    );
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  const [campus] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.campus (org_id, code, name_en) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, `C${run}`, `CPD campus ${run}`],
  );
  ids.campus = campus!.id;
  tokens.hr = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'HR' })).username);
  tokens.it = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'IT_ADMIN' })).username);
  for (const n of ['1', '2']) {
    const s = await as('hr')
      .post('/api/v1/hrm/staff')
      .send({
        campusId: ids.campus,
        staffNo: `CPD${n}-${run}`,
        fullNameEn: `Teacher ${n}`,
        gender: 'female',
        phone: `+88017${String(Date.now() + Number(n)).slice(-8)}`,
        staffType: 'teaching',
        joinedOn: '2090-01-01',
      });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    ids[`t${n}`] = s.body.data.id;
    const acc = await as('it')
      .post(`/api/v1/hrm/staff/${s.body.data.id}/account`)
      .send({ username: `cpd.t${n}.${run}`, password: PASSWORD, roleCode: 'CLASS_TEACHER', campusId: ids.campus });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    tokens[`t${n}`] = await login(`cpd.t${n}.${run}`);
  }
});

afterAll(async () => {
  await t.close();
});

describe('CPD', () => {
  it('session: capacity, self-registration, attendance, completion with certificate', async () => {
    const course = await as('hr')
      .post('/api/v1/hrm/cpd-courses')
      .send({ title: `Assessment for learning ${run}`, hours: 6, category: 'pedagogy', provider: 'British Council' });
    expect(course.status, JSON.stringify(course.body)).toBe(201);
    const session = await as('hr').post('/api/v1/hrm/cpd-sessions').send({
      courseId: course.body.data.id,
      campusId: ids.campus,
      startsAt: '2091-10-10T03:00:00Z',
      endsAt: '2091-10-10T09:00:00Z',
      venue: 'Library',
      trainer: 'Ms Rahman',
      capacity: 1,
    });
    expect(session.status, JSON.stringify(session.body)).toBe(201);
    ids.session = session.body.data.id;

    const sessions = await as('t1').get(`/api/v1/hrm/cpd-sessions?campusId=${ids.campus}`);
    expect(sessions.body.data.find((s: { id: string }) => s.id === ids.session)).toMatchObject({
      registered: 0,
      hours: 6,
    });
    const reg = await as('t1').post(`/api/v1/hrm/cpd-sessions/${ids.session}/register`).send({});
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect((await as('t1').post(`/api/v1/hrm/cpd-sessions/${ids.session}/register`).send({})).body.code).toBe(
      'SESSION_FULL',
    );
    expect((await as('t2').post(`/api/v1/hrm/cpd-sessions/${ids.session}/register`).send({})).body.code).toBe(
      'SESSION_FULL',
    );
    expect(
      (await as('t2').put(`/api/v1/hrm/cpd-sessions/${ids.session}/attendance`).send({ entries: [] })).status,
    ).toBe(403);

    clock.set(new Date('2091-10-10T10:00:00Z'));
    const late = await as('hr').post(`/api/v1/hrm/cpd-sessions/${ids.session}/register`).send({ staffId: ids.t2 });
    expect(late.body.code).toBe('SESSION_STARTED');
    const att = await as('hr')
      .put(`/api/v1/hrm/cpd-sessions/${ids.session}/attendance`)
      .send({ entries: [{ staffId: ids.t1, status: 'attended' }] });
    expect(att.status, JSON.stringify(att.body)).toBe(200);
    const notReg = await as('hr')
      .put(`/api/v1/hrm/cpd-sessions/${ids.session}/attendance`)
      .send({ entries: [{ staffId: ids.t2, status: 'attended' }] });
    expect(notReg.body.code).toBe('NOT_REGISTERED');
    const done = await as('hr').post(`/api/v1/hrm/cpd-sessions/${ids.session}/complete`).send();
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.records).toBe(1);

    const mine = await as('t1').get('/api/v1/hrm/cpd?year=2091');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data.totals).toEqual({ verifiedHours: 6, pendingHours: 0, targetHours: 20, progressPercent: 30 });
    const rec = mine.body.data.records[0];
    expect(rec).toMatchObject({ source: 'session', completedOn: '2091-10-10' });
    expect(rec.certificateNo).toMatch(/^CPD-91-\d{5}$/);
    ids.sessionRecord = rec.id;

    const pdf = await as('t1')
      .get(`/api/v1/hrm/cpd-records/${ids.sessionRecord}/certificate`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await as('t2').get(`/api/v1/hrm/cpd-records/${ids.sessionRecord}/certificate`)).status).toBe(404);
  });

  it('cancelling a session withdraws registrations and tells the registered staff', async () => {
    const course = await as('hr')
      .post('/api/v1/hrm/cpd-courses')
      .send({ title: `First aid ${run}`, hours: 3, category: 'safeguarding' });
    const session = await as('hr').post('/api/v1/hrm/cpd-sessions').send({
      courseId: course.body.data.id,
      campusId: ids.campus,
      startsAt: '2091-11-02T04:00:00Z',
      endsAt: '2091-11-02T07:00:00Z',
      capacity: 10,
    });
    expect(session.status, JSON.stringify(session.body)).toBe(201);
    expect((await as('t1').post(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/register`).send({})).status).toBe(
      200,
    );
    expect(
      (await as('t1').post(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/cancel`).send({ reason: 'Trainer ill' }))
        .status,
    ).toBe(403);
    const regs = await as('hr').get(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/registrations`);
    expect(regs.body.data).toEqual([
      expect.objectContaining({ staffId: ids.t1, name: 'Teacher 1', status: 'registered' }),
    ]);
    const cancel = await as('hr')
      .post(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/cancel`)
      .send({ reason: 'Trainer is ill; new date to follow' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.data).toEqual({ cancelled: 1 });
    expect(
      (await as('hr').post(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/cancel`).send({ reason: 'again' })).body
        .code,
    ).toBe('SESSION_CLOSED');
    expect((await as('t2').post(`/api/v1/hrm/cpd-sessions/${session.body.data.id}/register`).send({})).body.code).toBe(
      'SESSION_CLOSED',
    );
    const sent = await messages(`hrm.cpd_session_cancelled:${session.body.data.id}`);
    expect(sent.map((m) => m.channel)).toContain('sms');
    expect(sent.find((m) => m.channel === 'sms')!.body).toContain('Trainer is ill');
  });

  it('external training: logged by the teacher, verified by HR, counted towards the target', async () => {
    const ext = await as('t1').post('/api/v1/hrm/cpd-records').send({
      title: 'Online safeguarding level 2',
      provider: 'NSPCC Learning',
      completedOn: '2091-09-20',
      hours: 4.5,
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(ext.body.data.verifiedAt).toBeNull();
    const future = await as('t1')
      .post('/api/v1/hrm/cpd-records')
      .send({ title: 'Future course', completedOn: '2092-01-01', hours: 2 });
    expect(future.body.code).toBe('FUTURE_DATE');
    expect((await as('t1').post(`/api/v1/hrm/cpd-records/${ext.body.data.id}/verify`).send()).status).toBe(403);
    expect((await as('t1').get(`/api/v1/hrm/cpd-records/${ext.body.data.id}/certificate`)).body.code).toBe(
      'NO_CERTIFICATE',
    );

    const pending = await as('hr').get('/api/v1/hrm/cpd-records/pending?year=2091');
    expect(pending.body.data.map((r: { id: string }) => r.id)).toContain(ext.body.data.id);
    const ok = await as('hr').post(`/api/v1/hrm/cpd-records/${ext.body.data.id}/verify`).send();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await as('hr').post(`/api/v1/hrm/cpd-records/${ext.body.data.id}/verify`).send()).body.code).toBe(
      'ALREADY_VERIFIED',
    );

    const summary = await as('hr').get(`/api/v1/hrm/cpd/summary?year=2091&campusId=${ids.campus}`);
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    const byStaff = Object.fromEntries(
      summary.body.data.rows.map((r: { staffId: string; verifiedHours: number; met: boolean }) => [r.staffId, r]),
    );
    expect(byStaff[ids.t1!]).toMatchObject({ verifiedHours: 10.5, met: false });
    expect(byStaff[ids.t2!]).toMatchObject({ verifiedHours: 0, met: false });
    expect((await as('t2').get(`/api/v1/hrm/cpd?year=2091&staffId=${ids.t1}`)).status).toBe(404);
  });
});
