/**
 * Website admission forms (WEB-06): form setup with a signed token, enquiry with campaign / UTM tracking, spam
 * protection (honeypot, forged token, too fast, rate limit) stored but hidden, repeat-enquiry merge, acknowledgement
 * SMS, online application with draft-save and resume link, staff pipeline, application review, funnel per source and
 * campaign. Fixed clock in a dedicated test year (2096).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const START = new Date('2096-03-01T04:00:00Z');
const clock = new FixedClock(START);
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const phone = (n: number) => `+8801${3 + (n % 7)}${String(Date.now() + n * 97).slice(-8)}`;

const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) => request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`),
  patch: (url: string) => request(t.app).patch(url).set('Authorization', `Bearer ${tokens[who]}`),
});
const pub = {
  get: (url: string) => request(t.app).get(url),
  post: (url: string) => request(t.app).post(url),
  put: (url: string) => request(t.app).put(url),
};

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

async function drainOutbox(): Promise<void> {
  const { db, pool, logger, metrics } = t.container.cradle;
  await new OutboxRelay({
    db,
    pool,
    eventBus: t.container.resolve<EventBus>('eventBus'),
    subscriptions: t.container.resolve<SubscriptionRegistry>('subscriptions'),
    logger,
    metrics,
  }).drain();
}

async function sms(dedupeKey: string): Promise<string[]> {
  await drainOutbox();
  for (let i = 0; i < 50; i++) {
    const rows = await t.owner.query<{ body: string }>(
      `SELECT body FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
      [dedupeKey],
    );
    if (rows.length) return rows.map((r) => r.body);
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

/** a fresh form token, then time passes like a person filling the form in */
async function formToken(form: 'enquiry' | 'application' = 'enquiry', wait = 30): Promise<string> {
  const res = await pub.get(`/api/v1/adm/public/form?form=${form}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  clock.set(new Date(clock.now().getTime() + wait * 1000));
  return res.body.data.token as string;
}

const enquiryBody = (over: Record<string, unknown> = {}) => ({
  campusId: ids.dhn,
  academicYearId: ids.year,
  yearGroupId: ids.y3,
  childName: `Ayaan ${run}`,
  guardianName: 'Farhana Rahman',
  phone: ids.phone1,
  email: `farhana.${run}@example.com`,
  message: 'Is there a seat in Year 3 for next session?',
  ...over,
});

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, 'TEST-2096', '2096-01-01', '2096-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId],
  );
  ids.year = year!.id;
  const [y3] = await t.owner.query<{ id: string }>(
    `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = 'Y3'`,
    [orgId],
  );
  ids.y3 = y3!.id;
  ids.phone1 = phone(1);
  ids.phone2 = phone(2);
  const officer = await t.owner.createStaffUser({
    password: PASSWORD,
    roleCode: 'ADMISSION_OFFICER',
    campusCode: 'DHN',
  });
  ids.officer = officer.id;
  tokens.officer = await login(officer.username);
});

afterAll(async () => {
  await t.close();
});

describe('campaigns and the public form', () => {
  it('campaign with a tracked link; the form shows choices, a token and the campaign', async () => {
    const c = await as('officer')
      .post('/api/v1/adm/campaigns')
      .send({
        code: `OPEN${run}`.toUpperCase().slice(0, 20),
        name: 'Open day poster',
        channel: 'qr',
        utmSource: 'poster',
        utmMedium: 'qr',
        utmCampaign: `openday-${run}`,
        budgetPaisa: 1_000_000,
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    ids.campaign = c.body.data.id;
    ids.campaignCode = c.body.data.code;
    expect(c.body.data.link).toContain(`/admissions/enquire?campaign=${c.body.data.code}&utm_source=poster`);

    const form = await pub.get(`/api/v1/adm/public/form?campaign=${ids.campaignCode}`);
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    expect(form.body.data.campaign).toMatchObject({ code: ids.campaignCode, name: 'Open day poster' });
    expect(form.body.data.captchaSiteKey).toBeNull();
    expect(form.body.data.academicYears.map((y: { id: string }) => y.id)).toContain(ids.year);
    expect(form.body.data.yearGroups.map((y: { id: string }) => y.id)).toContain(ids.y3);
    expect(form.body.data.token).toMatch(/^[\w-]+\.[\w-]+$/);
  });
});

describe('website enquiry', () => {
  it('a real enquiry lands in the inbox with its campaign and source; the family gets an SMS', async () => {
    const res = await pub.post('/api/v1/adm/public/enquiries').send(
      enquiryBody({
        token: await formToken(),
        website: '',
        tracking: { campaign: ids.campaignCode, referrer: 'https://l.facebook.com/', landingUrl: 'https://x/a' },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.data.reference).toMatch(/^ENQ-DHN-96-\d{5}$/);
    ids.ref1 = res.body.data.reference;

    const inbox = await as('officer').get(`/api/v1/adm/enquiries?q=${encodeURIComponent(ids.ref1!)}`);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({
      sourceCode: 'qr',
      campaignId: ids.campaign,
      stage: 'enquiry',
      isSpam: false,
      utm: null,
    });
    ids.enquiry1 = inbox.body.data[0].id;
    const text = await sms(`adm.enquiry_received:${ids.enquiry1}`);
    expect(text[0]).toContain(ids.ref1);
  });

  it('spam is accepted silently but hidden: honeypot, forged token, posted too fast', async () => {
    const honeypot = await pub
      .post('/api/v1/adm/public/enquiries')
      .send(
        enquiryBody({
          token: await formToken(),
          website: 'http://seo.example',
          phone: phone(3),
          childName: `Spam${run}A`,
        }),
      );
    expect(honeypot.status).toBe(202);
    const forged = await pub
      .post('/api/v1/adm/public/enquiries')
      .send(enquiryBody({ token: 'abc.def', phone: phone(4), childName: `Spam${run}B` }));
    expect(forged.status).toBe(202);
    const fast = await pub
      .post('/api/v1/adm/public/enquiries')
      .send(enquiryBody({ token: await formToken('enquiry', 1), phone: phone(5), childName: `Spam${run}C` }));
    expect(fast.status).toBe(202);

    const visible = await as('officer').get(`/api/v1/adm/enquiries?q=Spam${run}`);
    expect(visible.body.data).toHaveLength(0);
    const spam = await as('officer').get(`/api/v1/adm/enquiries?q=Spam${run}&spam=true`);
    const reasons = Object.fromEntries(
      spam.body.data.map((e: { childName: string; spamReasons: string[] }) => [e.childName, e.spamReasons]),
    );
    expect(reasons[`Spam${run}A`]).toContain('honeypot');
    expect(reasons[`Spam${run}B`]).toContain('token_invalid');
    expect(reasons[`Spam${run}C`]).toContain('too_fast');
    const log = await t.owner.query<{ outcome: string }>(
      `SELECT outcome FROM adm.web_submission WHERE created_at > now() - interval '1 hour' AND reasons && ARRAY['honeypot','token_invalid','too_fast']`,
    );
    expect(log.length).toBeGreaterThanOrEqual(3);

    // a false positive is released into the inbox
    const botC = spam.body.data.find((e: { childName: string }) => e.childName === `Spam${run}C`);
    const released = await as('officer').post(`/api/v1/adm/enquiries/${botC.id}/spam`).send({ isSpam: false });
    expect(released.body.data.isSpam).toBe(false);
    expect((await as('officer').get(`/api/v1/adm/enquiries?q=Spam${run}`)).body.data).toHaveLength(1);
  });

  it('the same family asking again is merged; then the IP is rate-limited', async () => {
    const again = await pub
      .post('/api/v1/adm/public/enquiries')
      .send(enquiryBody({ token: await formToken(), message: 'Following up: can we visit on Sunday?' }));
    expect(again.status).toBe(202);
    expect(again.body.data.reference).toBe(ids.ref1);
    const e = await as('officer').get(`/api/v1/adm/enquiries/${ids.enquiry1}`);
    expect(e.body.data.repeatCount).toBe(1);
    expect(e.body.data.activities[0].notes).toContain('Enquired again');

    const limited = await pub
      .post('/api/v1/adm/public/enquiries')
      .send(enquiryBody({ token: await formToken(), phone: phone(6), childName: 'Sixth' }));
    expect(limited.status).toBe(429);
  });
});

describe('online application', () => {
  const appBody = (over: Record<string, unknown> = {}) => ({
    campusId: ids.dhn,
    academicYearId: ids.year,
    yearGroupId: ids.y3,
    childFirstName: 'Inaya',
    childLastName: `Hasan ${run}`,
    childGender: 'female',
    childDob: '2089-05-10',
    guardians: [
      { name: 'Tanvir Hasan', relationship: 'father', phone: ids.phone2, email: `tanvir.${run}@example.com` },
    ],
    address: 'House 12, Road 5, Dhanmondi',
    ...over,
  });

  it('draft saved with a secret link, continued later and submitted: enquiry at "applied", SMS with the number', async () => {
    const draft = await pub.post('/api/v1/adm/public/applications').send(
      appBody({
        token: await formToken('application'),
        draft: true,
        tracking: { utmSource: 'facebook', utmMedium: 'paid' },
      }),
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.data).toMatchObject({ status: 'draft', applicationNo: null });
    const link = draft.body.data.resumeToken as string;
    expect(link).toMatch(/^[\w-]{20,64}$/);

    const loaded = await pub.get(`/api/v1/adm/public/applications/${link}`);
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
    expect(loaded.body.data).toMatchObject({ childFirstName: 'Inaya', status: 'draft' });
    expect(loaded.body.data.clientIp).toBeUndefined();
    expect((await pub.get('/api/v1/adm/public/applications/wrong-token-1234567890')).status).toBe(404);

    const submit = await pub
      .put(`/api/v1/adm/public/applications/${link}`)
      .send({ ...appBody({ previousSchool: 'Sunbeams' }), submit: true });
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);
    expect(submit.body.data.applicationNo).toMatch(/^APP-DHN-96-\d{5}$/);
    ids.appNo = submit.body.data.applicationNo;
    expect((await pub.get(`/api/v1/adm/public/applications/${link}`)).status).toBe(404); // link used up

    const list = await as('officer').get(`/api/v1/adm/applications?q=${ids.appNo}`);
    expect(list.body.data[0]).toMatchObject({
      status: 'submitted',
      sourceCode: 'facebook',
      previousSchool: 'Sunbeams',
    });
    ids.application = list.body.data[0].id;
    const enquiry = await as('officer').get(`/api/v1/adm/enquiries/${list.body.data[0].enquiryId}`);
    expect(enquiry.body.data.stage).toBe('applied');
    expect((await sms(`adm.application_submitted:${ids.application}`))[0]).toContain(ids.appNo);
  });

  it('a direct application links to the family enquiry and moves it to "applied"', async () => {
    const res = await pub.post('/api/v1/adm/public/applications').send({
      ...appBody({
        childFirstName: `Ayaan`,
        childLastName: run,
        guardians: [{ name: 'Farhana Rahman', relationship: 'mother', phone: ids.phone1 }],
      }),
      token: await formToken('application'),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('submitted');
    const e = await as('officer').get(`/api/v1/adm/enquiries/${ids.enquiry1}`);
    expect(e.body.data.stage).toBe('applied');
    expect(e.body.data.applications).toHaveLength(1);
  });
});

describe('admission office', () => {
  it('pipeline: activity, task sets the follow-up, lost needs a reason; review needs a reason to reject', async () => {
    const task = await as('officer')
      .post(`/api/v1/adm/enquiries/${ids.enquiry1}/activities`)
      .send({ kind: 'task', notes: 'Call about the campus visit', dueAt: '2096-03-03T05:00:00Z' });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect((await as('officer').get(`/api/v1/adm/enquiries/${ids.enquiry1}`)).body.data.nextFollowUpAt).toBe(
      '2096-03-03T05:00:00.000Z',
    );
    const lost = await as('officer').patch(`/api/v1/adm/enquiries/${ids.enquiry1}`).send({ stage: 'lost' });
    expect(lost.body.code).toBe('LOST_REASON_REQUIRED');

    const reject = await as('officer')
      .post(`/api/v1/adm/applications/${ids.application}/status`)
      .send({ status: 'rejected' });
    expect(reject.body.code).toBe('NOTE_REQUIRED');
    const review = await as('officer')
      .post(`/api/v1/adm/applications/${ids.application}/status`)
      .send({ status: 'under_review' });
    expect(review.body.data.status).toBe('under_review');
    const no = await as('officer')
      .post(`/api/v1/adm/applications/${ids.application}/status`)
      .send({ status: 'rejected', note: 'Class full; offered waiting list for next year' });
    expect(no.body.data.status).toBe('rejected');
  });

  it('funnel per source and campaign, spam apart, cost per enquiry', async () => {
    const f = await as('officer').get('/api/v1/adm/funnel?from=2026-01-01&to=2096-12-31');
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    const camp = f.body.data.byCampaign.find((c: { campaignId: string }) => c.campaignId === ids.campaign);
    expect(camp).toMatchObject({ code: ids.campaignCode, enquiries: 1, applied: 1, costPerEnquiryPaisa: 1_000_000 });
    expect(f.body.data.totals.spam).toBeGreaterThanOrEqual(2);
    expect(f.body.data.bySource.map((s: { sourceCode: string }) => s.sourceCode)).toEqual(
      expect.arrayContaining(['qr', 'facebook']),
    );
    expect((await request(t.app).get('/api/v1/adm/funnel?from=2096-01-01&to=2096-12-31')).status).toBe(401);
  });
});
