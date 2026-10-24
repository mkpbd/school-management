/**
 * Notice board end-to-end: targeted notice (class section) -> recipients resolved -> guardian board + read receipt
 * -> outsiders cannot read -> urgent SMS -> scheduled publishing -> numbered circular -> website listing / withdraw.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const START = new Date('2091-09-14T04:00:00Z');
const clock = new FixedClock(START);

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
  const res = await request(t.app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: /(\d{6})/.exec(msg!.body)![1], client: 'parent_app' });
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
  tokens.coord = await login(
    (await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'ACADEMIC_COORDINATOR', campusCode: 'DHN' }))
      .username,
  );
  tokens.principal = await login(
    (await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'PRINCIPAL' })).username,
  );
  for (const s of ['N', 'O']) {
    const sec = await as('coord')
      .post('/api/v1/aca/sections')
      .send({
        campusId: ids.dhn,
        academicYearId: year!.id,
        yearGroupId: y8!.id,
        name: `${s}${run}`,
        displayName: `Y8 ${s} ${run}`,
        capacity: 30,
      });
    expect(sec.status, JSON.stringify(sec.body)).toBe(201);
    ids[`section${s}`] = sec.body.data.id;
  }
  // two families in section N, one in section O
  for (const [n, key, section] of [
    [0, 'A', 'N'],
    [1, 'B', 'N'],
    [2, 'C', 'O'],
  ] as const) {
    const phone = `+8801${5 + n}${String(Date.now() + n * 11).slice(-8)}`;
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: `Reader${key}`,
          lastNameEn: `Ntc${run}`,
          gender: 'female',
          dateOfBirth: '2078-02-02',
          admittedOn: '2091-01-05',
        },
        guardians: [
          {
            fullNameEn: `Guardian ${key}`,
            phone,
            relationship: 'mother',
            preferredLocale: 'en',
            isPrimaryContact: true,
          },
        ],
        enrolment: { classSectionId: ids[`section${section}`] },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[`phone${key}`] = phone;
    ids[`student${key}`] = res.body.data.student.id;
  }
  tokens.parentA = await guardianLogin(ids.phoneA!);
  tokens.parentC = await guardianLogin(ids.phoneC!);
});

afterAll(async () => {
  await t.close();
});

describe('notice board', () => {
  it('validation: audience ids, campus of a campus-scoped author', async () => {
    const noId = await as('coord')
      .post('/api/v1/com/notices')
      .send({ campusId: ids.dhn, titleEn: 'Trip', bodyEn: 'Body text', audiences: [{ type: 'class_section' }] });
    expect(noId.body.code).toBe('AUDIENCE_INVALID');
    const allCampuses = await as('coord')
      .post('/api/v1/com/notices')
      .send({ campusId: null, titleEn: 'Trip', bodyEn: 'Body text', audiences: [{ type: 'everyone' }] });
    expect(allCampuses.body.code).toBe('CAMPUS_REQUIRED');
  });

  it('class notice reaches only that class: board, read receipt, outsiders blocked', async () => {
    const res = await as('coord')
      .post('/api/v1/com/notices')
      .send({
        campusId: ids.dhn,
        titleEn: `Science fair ${run}`,
        bodyEn: 'Bring your project boards on Thursday. Parents are welcome from 10 am.',
        category: 'event',
        audiences: [{ type: 'class_section', id: ids.sectionN }],
        publishNow: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'published', recipientCount: 2 });
    ids.notice = res.body.data.id;

    const board = await as('parentA').get('/api/v1/com/me/notices');
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    expect(board.body.data.find((n: { id: string }) => n.id === ids.notice)).toMatchObject({ readAt: null });
    expect(
      (await as('parentC').get('/api/v1/com/me/notices')).body.data.map((n: { id: string }) => n.id),
    ).not.toContain(ids.notice);
    expect((await as('parentC').get(`/api/v1/com/notices/${ids.notice}`)).status).toBe(404);
    expect((await as('parentC').post(`/api/v1/com/notices/${ids.notice}/read`).send()).status).toBe(404);

    const read = await as('parentA').post(`/api/v1/com/notices/${ids.notice}/read`).send();
    expect(read.body.data.firstRead).toBe(true);
    expect((await as('parentA').post(`/api/v1/com/notices/${ids.notice}/read`).send()).body.data.firstRead).toBe(false);
    const receipts = await as('coord').get(`/api/v1/com/notices/${ids.notice}/receipts`);
    expect(receipts.status, JSON.stringify(receipts.body)).toBe(200);
    expect(receipts.body.data).toMatchObject({
      recipients: 2,
      read: 1,
      readPercent: 50,
      byType: { guardian: { recipients: 2, read: 1 } },
    });
    expect(receipts.body.data.unread).toHaveLength(1);
    expect(receipts.body.data.unread[0].contact).toMatch(/\*\*\*\*/);
    expect(
      (await as('parentA').get('/api/v1/com/me/notices?unreadOnly=true')).body.data.map((n: { id: string }) => n.id),
    ).not.toContain(ids.notice);
  });

  it('houses: list, create, place a student, notice to the house reaches only its families', async () => {
    const houses = await as('coord').get('/api/v1/cca/houses?pageSize=50');
    expect(houses.status, JSON.stringify(houses.body)).toBe(200);
    expect(houses.body.data.map((h: { code: string }) => h.code)).toEqual(expect.arrayContaining(['RED', 'BLUE']));
    const h = await as('coord')
      .post('/api/v1/cca/houses')
      .send({ code: `H${run}`, nameEn: `Test House ${run}` });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const placed = await request(t.app)
      .patch(`/api/v1/sis/students/${ids.studentC}`)
      .set('Authorization', `Bearer ${tokens.coord}`)
      .send({ houseId: h.body.data.id });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    const notice = await as('coord')
      .post('/api/v1/com/notices')
      .send({
        campusId: ids.dhn,
        titleEn: `House meeting ${run}`,
        bodyEn: 'House captains meet on Sunday after assembly.',
        audiences: [{ type: 'house', id: h.body.data.id }],
        publishNow: true,
      });
    expect(notice.status, JSON.stringify(notice.body)).toBe(201);
    expect(notice.body.data.recipientCount).toBe(1);
    const mine = (who: string) =>
      as(who)
        .get('/api/v1/com/me/notices')
        .then((r) => r.body.data.map((n: { id: string }) => n.id));
    expect(await mine('parentC')).toContain(notice.body.data.id);
    expect(await mine('parentA')).not.toContain(notice.body.data.id);
  });

  it('urgent notice also goes by SMS', async () => {
    const res = await as('coord')
      .post('/api/v1/com/notices')
      .send({
        campusId: ids.dhn,
        titleEn: `School closed tomorrow ${run}`,
        bodyEn: 'Due to heavy rain the campus will remain closed tomorrow. Online classes continue as scheduled.',
        priority: 'urgent',
        audiences: [{ type: 'class_section', id: ids.sectionO }],
        publishNow: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await drainOutbox();
    const sms = await t.owner.query<{ body: string; recipient_address: string }>(
      `SELECT body, recipient_address FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
      [`com.notice:${res.body.data.id}`],
    );
    expect(sms.map((m) => m.recipient_address)).toEqual([ids.phoneC]);
    expect(sms[0]!.body).toContain('School closed tomorrow');
  });

  it('scheduled publishing, numbered circular, website listing and withdrawal', async () => {
    const later = new Date(START.getTime() + 2 * 3_600_000);
    const res = await as('principal')
      .post('/api/v1/com/notices')
      .send({
        campusId: null,
        titleEn: `Annual sports day ${run}`,
        bodyEn: 'The annual sports day will be held on 20 September at the main field.',
        isCircular: true,
        publishToWebsite: true,
        publishAt: later.toISOString(),
        audiences: [{ type: 'guardians' }],
        publishNow: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'scheduled', category: 'circular', circularNo: null });
    ids.circular = res.body.data.id;
    const site = () => request(t.app).get('/api/v1/com/public/notices?limit=50');
    expect((await site()).body.data.map((n: { id: string }) => n.id)).not.toContain(ids.circular);

    clock.set(new Date(later.getTime() + 60_000));
    const due = await as('principal').post('/api/v1/com/tasks/publish-due-notices').send();
    expect(due.body.data.published).toBeGreaterThanOrEqual(1);
    const pub = await as('principal').get(`/api/v1/com/notices/${ids.circular}`);
    expect(pub.body.data).toMatchObject({ status: 'published' });
    expect(pub.body.data.circularNo).toMatch(/^CIR-91-\d{4}$/);
    expect(pub.body.data.recipientCount).toBeGreaterThanOrEqual(3);
    expect((await as('parentC').get('/api/v1/com/me/notices')).body.data.map((n: { id: string }) => n.id)).toContain(
      ids.circular,
    );

    const listed = await site();
    expect(listed.status).toBe(200);
    expect(listed.body.data.find((n: { id: string }) => n.id === ids.circular)).toMatchObject({
      circularNo: pub.body.data.circularNo,
    });
    expect(
      (await as('principal').post(`/api/v1/com/notices/${ids.circular}/withdraw`).send({ reason: 'Postponed' })).status,
    ).toBe(200);
    expect((await site()).body.data.map((n: { id: string }) => n.id)).not.toContain(ids.circular);
    expect(
      (await as('parentC').get('/api/v1/com/me/notices')).body.data.map((n: { id: string }) => n.id),
    ).not.toContain(ids.circular);
  });
});
