/**
 * E-mail / push / preferences through HTTP and the notification hub: preferences (mandatory events), personal quiet
 * hours, push devices, every event on e-mail + push (SMS-text fallback, HTML layout, escaping), in-app inbox,
 * template versions with preview and activation.
 */
import { asValue } from 'awilix';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Notifier } from '../../src/shared/application/ports.js';
import { systemContext } from '../../src/shared/application/RequestContext.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const clock = new FixedClock(new Date('2091-10-01T17:00:00Z')); // 23:00 in Dhaka

let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const as = (who: string) => ({
  del: (url: string) => request(t.app).delete(url).set('Authorization', `Bearer ${tokens[who]}`),
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

async function dispatch(n: Parameters<Notifier['dispatch']>[0]) {
  const scope = t.container.createScope();
  scope.register({ ctx: asValue(systemContext(ids.org!, `test-${Date.now()}`)) });
  try {
    return await scope.resolve<Notifier>('notifier').dispatch(n);
  } finally {
    await scope.dispose();
  }
}

const outbound = (dedupe: string) =>
  t.owner.query<{
    channel: string;
    subject: string | null;
    body: string;
    recipient_address: string;
    scheduled_for: Date | null;
  }>(
    `SELECT channel, subject, body, recipient_address, scheduled_for FROM com.outbound_message WHERE dedupe_key = $1 ORDER BY channel`,
    [dedupe],
  );

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  ids.org = await t.owner.orgId();
  const hr = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'HR' });
  ids.user = hr.id;
  ids.email = `${hr.username}@test.local`;
  tokens.hr = await login(hr.username);
  tokens.it = await login((await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'IT_ADMIN' })).username);
});

afterAll(async () => {
  await t.close();
});

describe('preferences, quiet hours, devices', () => {
  it('lists events with channels; mandatory events cannot be muted', async () => {
    const res = await as('hr').get('/api/v1/com/me/notification-preferences');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.schoolQuietHours).toEqual({ from: '21:30', to: '07:00' });
    const payslip = res.body.data.events.find((e: { eventCode: string }) => e.eventCode === 'hrm.payslip_ready');
    expect(payslip.channels.map((c: { channel: string }) => c.channel).sort()).toEqual(['email', 'push', 'sms']);
    expect(res.body.data.events.find((e: { eventCode: string }) => e.eventCode === 'iam.otp').mandatory).toBe(true);

    const bad = await as('hr')
      .put('/api/v1/com/me/notification-preferences')
      .send({ settings: [{ eventCode: 'iam.otp', channel: 'sms', enabled: false }] });
    expect(bad.body.code).toBe('MANDATORY_EVENT');
    const ok = await as('hr')
      .put('/api/v1/com/me/notification-preferences')
      .send({
        quietHours: { from: '22:00', to: '06:30' },
        settings: [{ eventCode: 'hrm.payslip_ready', channel: 'sms', enabled: false }],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await as('hr').get('/api/v1/com/me/notification-preferences');
    expect(after.body.data.quietHours).toEqual({ from: '22:00', to: '06:30' });
    const sms = after.body.data.events
      .find((e: { eventCode: string }) => e.eventCode === 'hrm.payslip_ready')
      .channels.find((c: { channel: string }) => c.channel === 'sms');
    expect(sms.enabled).toBe(false);
  });

  it('push devices: register, list (token tail only), revoke', async () => {
    ids.token = `fcm-token-${run}-${'x'.repeat(40)}`;
    const reg = await as('hr')
      .post('/api/v1/com/me/push-devices')
      .send({ token: ids.token, app: 'staff', platform: 'android', locale: 'en' });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const list = await as('hr').get('/api/v1/com/me/push-devices');
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(ids.token);
  });
});

describe('delivery', () => {
  it('every channel from one event: muted SMS skipped, HTML e-mail escaped, push to the device, quiet hours', async () => {
    const r = await dispatch({
      eventCode: 'hrm.payslip_ready',
      recipients: [{ userId: ids.user, phone: '+8801711000999', email: ids.email, locale: 'en' }],
      channels: ['sms', 'email', 'push'],
      data: { month: 'September <2091>', school: 'Lighthouse <School>' },
      dedupeKey: `msg-test:${run}`,
    });
    expect(r).toMatchObject({ queued: 2, suppressed: 1 }); // SMS muted by the user
    const rows = await outbound(`msg-test:${run}`);
    expect(rows.map((m) => m.channel)).toEqual(['email', 'push']);
    const email = rows.find((m) => m.channel === 'email')!;
    expect(email.subject).toBe('Your payslip for September <2091>');
    expect(email.body).toMatch(/^<!doctype html>/);
    expect(email.body).toContain('September &lt;2091&gt;'); // escaped inside the HTML template
    expect(email.body).toContain('Lighthouse &lt;School&gt;');
    expect(email.body).not.toContain('<2091>');
    const push = rows.find((m) => m.channel === 'push')!;
    expect(push.recipient_address).toBe(ids.token);
    expect(push.subject).toBe('Lighthouse <School>');
    // 23:00 Dhaka is inside the user's 22:00-06:30 window: held until 06:30
    expect(new Date(push.scheduled_for!).toISOString()).toBe('2091-10-02T00:30:00.000Z');
  });

  it('an event without e-mail template still e-mails its SMS text; high priority skips quiet hours', async () => {
    await dispatch({
      eventCode: 'att.absent',
      recipients: [{ userId: ids.user, email: ids.email, locale: 'en' }],
      channels: ['email'],
      data: { student_name: 'Ayaan', class: 'Y7-A', date: '2091-10-01', school: 'Lighthouse' },
      dedupeKey: `msg-test2:${run}`,
      priority: 'high',
    });
    const [email] = await outbound(`msg-test2:${run}`);
    expect(email!.subject).toBe('Absent - Lighthouse');
    expect(email!.body).toContain('Ayaan (Y7-A) is absent today');
    expect(email!.scheduled_for).toBeNull();
  });

  it('in-app inbox and device revocation', async () => {
    await dispatch({
      eventCode: 'hrm.payslip_ready',
      recipients: [{ userId: ids.user }],
      channels: ['in_app'],
      data: { month: 'October', school: 'Lighthouse' },
      dedupeKey: `msg-test3:${run}`,
    });
    const inbox = await as('hr').get('/api/v1/com/me/inbox');
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    expect(inbox.body.data[0]).toMatchObject({ eventCode: 'hrm.payslip_ready' });
    expect(inbox.body.data[0].body).toContain('October');

    expect(
      (await as('hr').post('/api/v1/com/me/push-devices/revoke').send({ token: ids.token })).body.data.revoked,
    ).toBe(true);
    expect((await as('hr').get('/api/v1/com/me/push-devices')).body.data).toHaveLength(0);

    // from the device list, without the token
    await as('hr')
      .post('/api/v1/com/me/push-devices')
      .send({ token: `${ids.token}-tablet`, app: 'staff', platform: 'android', locale: 'en' });
    const [device] = (await as('hr').get('/api/v1/com/me/push-devices')).body.data as Array<{ id: string }>;
    expect((await as('it').del(`/api/v1/com/me/push-devices/${device!.id}`)).status).toBe(404); // not theirs
    expect((await as('hr').del(`/api/v1/com/me/push-devices/${device!.id}`)).status).toBe(204);
    expect((await as('hr').del(`/api/v1/com/me/push-devices/${device!.id}`)).status).toBe(404);
    expect((await as('hr').get('/api/v1/com/me/push-devices')).body.data).toHaveLength(0);
  });
});

describe('templates', () => {
  it('new version, preview in the layout, activate replaces the live one', async () => {
    const draft = await as('it').post('/api/v1/com/templates').send({
      eventCode: 'att.late',
      channel: 'email',
      locale: 'en',
      subject: 'Late arrival: {{student_name}}',
      body: '<p>{{student_name}} arrived at <strong>{{time}}</strong>.</p>',
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.data).toMatchObject({ isActive: false });
    const broken = await as('it')
      .post('/api/v1/com/templates')
      .send({ eventCode: 'att.late', channel: 'email', locale: 'en', body: '<p>{{#if x}}</p>' });
    expect(broken.body.code).toBe('TEMPLATE_INVALID');

    const preview = await as('it')
      .post('/api/v1/com/templates/preview')
      .send({
        channel: 'email',
        subject: draft.body.data.subject,
        body: draft.body.data.body,
        data: { student_name: 'Zara <Z>', time: '08:41' },
        school: 'Lighthouse',
      });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.subject).toBe('Late arrival: Zara <Z>');
    expect(preview.body.data.body).toContain('Zara &lt;Z&gt; arrived at <strong>08:41</strong>');

    const act = await as('it').post(`/api/v1/com/templates/${draft.body.data.id}/activate`).send();
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    const live = await as('it').get('/api/v1/com/templates?eventCode=att.late&channel=email');
    expect(live.body.data.filter((x: { isActive: boolean }) => x.isActive).map((x: { id: string }) => x.id)).toEqual([
      draft.body.data.id,
    ]);
    expect((await as('hr').get('/api/v1/com/templates')).status).toBe(403);
  });
});
