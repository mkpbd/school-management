/**
 * End-to-end through HTTP: vehicle + documents + crew -> stops / route -> student seats -> GPS device key ->
 * trip -> device / phone / driver-app fixes -> "bus near your stop" SMS -> live fleet (SSE too) -> overspeed alert ->
 * parent view -> history. Fixed clock in the 2091 test year; fixes outside current partitions land in the default one.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

let SCHOOL_DAY = LocalDate.parse('2091-05-01');
while (![0, 1, 2, 3, 4].includes(SCHOOL_DAY.dayOfWeek())) SCHOOL_DAY = SCHOOL_DAY.addDays(1);
const START = new Date(`${SCHOOL_DAY.iso}T01:00:00Z`); // 07:00 in Dhaka, morning pickup
const clock = new FixedClock(START);
const ago = (sec: number) => new Date(clock.now().getTime() - sec * 1000).toISOString();

// Gulshan, Dhaka: S1 and S2 about 1.7 km apart
const S1 = { lat: 23.7806, lng: 90.4193 };
const S2 = { lat: 23.7925, lng: 90.4078 };

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
  put: (url: string) => request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`),
});

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

async function guardianLogin(phone: string): Promise<string> {
  const req = await request(t.app).post('/api/v1/auth/otp/request').send({ phone });
  expect(req.status).toBe(202);
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

const device = (key = ids.deviceKey!) => ({
  ingest: (pings: unknown[]) =>
    request(t.app)
      .post('/api/v1/trn/gps/ingest')
      .set('X-Device-Id', ids.deviceId!)
      .set('X-Device-Key', key)
      .send({ pings }),
});

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, $2, '2091-01-01', '2091-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId, YEAR_CODE],
  );
  ids.year = year!.id;
  const [y8] = await t.owner.query<{ id: string }>(
    `SELECT y.id FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = $1 AND y.code = 'Y8'`,
    [orgId],
  );

  for (const [who, roleCode, campus] of [
    ['transport', 'TRANSPORT', 'DHN'],
    ['coord', 'ACADEMIC_COORDINATOR', 'DHN'],
    ['hr', 'HR', undefined],
    ['it', 'IT_ADMIN', undefined],
  ] as const) {
    const u = await t.owner.createStaffUser({ password: PASSWORD, roleCode, campusCode: campus });
    tokens[who] = await login(u.username);
  }

  // the driver: staff record + DRIVER login
  const staff = await as('hr')
    .post('/api/v1/hrm/staff')
    .send({
      campusId: ids.dhn,
      staffNo: `DRV-${run}`,
      fullNameEn: 'Karim Driver',
      gender: 'male',
      phone: `+88013${String(Date.now()).slice(-8)}`,
      staffType: 'support',
      joinedOn: '2090-01-01',
    });
  expect(staff.status, JSON.stringify(staff.body)).toBe(201);
  ids.driverStaff = staff.body.data.id;
  const account = await as('it')
    .post(`/api/v1/hrm/staff/${ids.driverStaff}/account`)
    .send({ username: `driver.${run}`, password: PASSWORD, roleCode: 'DRIVER', campusId: ids.dhn });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  tokens.driver = await login(`driver.${run}`);

  // three Year 8 students from three families
  const section = await as('coord')
    .post('/api/v1/aca/sections')
    .send({
      campusId: ids.dhn,
      academicYearId: ids.year,
      yearGroupId: y8!.id,
      name: `T${run}`,
      displayName: `Year 8 - T (${run})`,
      capacity: 30,
    });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  for (const [n, key] of ['A', 'B', 'C'].entries()) {
    const phone = `+8801${5 + n}${String(Date.now() + n).slice(-8)}`;
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: `Rider${key}`,
          lastNameEn: `Trn${run}`,
          gender: 'male',
          dateOfBirth: '2078-03-01',
          admittedOn: '2091-01-05',
        },
        guardians: [
          {
            fullNameEn: `Guardian ${key}`,
            phone,
            relationship: 'father',
            preferredLocale: 'en',
            isPrimaryContact: true,
          },
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

describe('fleet set-up (TRN-01, TRN-02)', () => {
  it('vehicle with documents, a GPS device key and a licensed driver', async () => {
    const v = await as('transport')
      .post('/api/v1/trn/vehicles')
      .send({ regNo: `DHAKA-METRO-JA-${run}`, kind: 'minibus', capacity: 2 });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    ids.vehicle = v.body.data.id;

    const doc = await as('transport')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/documents`)
      .send({ docType: 'fitness', docNo: `FIT-${run}`, expiresOn: SCHOOL_DAY.addDays(10).iso });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    const expiring = await as('transport').get(
      `/api/v1/trn/vehicle-documents/expiring?withinDays=30&campusId=${ids.dhn}`,
    );
    expect(expiring.body.data.find((d: { docNo: string }) => d.docNo === `FIT-${run}`)).toMatchObject({ daysLeft: 10 });

    ids.deviceId = `BUS-${run}`;
    const key = await as('transport')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/device-key`)
      .send({ deviceId: ids.deviceId });
    expect(key.status, JSON.stringify(key.body)).toBe(200);
    expect(key.body.data.deviceKey).toMatch(/^[\w-]{32}$/);
    ids.deviceKey = key.body.data.deviceKey;
    const shown = await as('transport').get(`/api/v1/trn/vehicles/${ids.vehicle}`);
    expect(shown.body.data.gpsDeviceId).toBe(ids.deviceId);
    expect(JSON.stringify(shown.body)).not.toContain('KeyHash');

    const noLicence = await as('transport')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/crew`)
      .send({ staffId: ids.driverStaff, role: 'driver' });
    expect(noLicence.body.code).toBe('LICENCE_REQUIRED');
    const crew = await as('transport')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/crew`)
      .send({
        staffId: ids.driverStaff,
        role: 'driver',
        licenceNo: `DL-${run}`,
        licenceExpiresOn: '2093-01-01',
        validFrom: '2091-01-01',
      });
    expect(crew.status, JSON.stringify(crew.body)).toBe(201);
  });

  it('stops, route and seats limited by the vehicle', async () => {
    const mk = (name: string, p: { lat: number; lng: number }) =>
      as('transport')
        .post('/api/v1/trn/stops')
        .send({ name: `${name} ${run}`, area: 'Gulshan', ...p });
    const s1 = await mk('Gulshan 1', S1);
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    ids.s1 = s1.body.data.id;
    ids.s2 = (await mk('Gulshan 2', S2)).body.data.id;
    ids.s3 = (await mk('Elsewhere', { lat: 23.75, lng: 90.39 })).body.data.id;

    const r = await as('transport')
      .post('/api/v1/trn/routes')
      .send({ campusId: ids.dhn, code: `R${run}`.slice(0, 20), name: `Gulshan route ${run}`, vehicleId: ids.vehicle });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids.route = r.body.data.id;
    const stops = await as('transport')
      .put(`/api/v1/trn/routes/${ids.route}/stops`)
      .send({
        stops: [
          { stopId: ids.s1, pickupTime: '07:10' },
          { stopId: ids.s2, pickupTime: '07:20' },
        ],
      });
    expect(stops.status, JSON.stringify(stops.body)).toBe(200);
    expect(stops.body.data.map((s: { seq: number }) => s.seq)).toEqual([1, 2]);

    const seat = (student: string, stopId: string) =>
      as('transport')
        .post('/api/v1/trn/assignments')
        .send({ studentId: ids[student], routeId: ids.route, pickupStopId: stopId, validFrom: '2091-01-10' });
    expect((await seat('studentA', ids.s3!)).body.code).toBe('STOP_NOT_ON_ROUTE');
    const a = await seat('studentA', ids.s1!);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data.seatsLeft).toBe(1);
    expect((await seat('studentA', ids.s1!)).body.code).toBe('ALREADY_ASSIGNED');
    expect((await seat('studentB', ids.s2!)).status).toBe(201);
    expect((await seat('studentC', ids.s1!)).body.code).toBe('ROUTE_FULL');

    const manifest = await as('driver').get(`/api/v1/trn/routes/${ids.route}/manifest`);
    expect(manifest.status, JSON.stringify(manifest.body)).toBe(200);
    expect(manifest.body.data.map((m: { studentName: string }) => m.studentName).sort()).toEqual([
      `RiderA Trn${run}`,
      `RiderB Trn${run}`,
    ]);
  });
});

describe('live tracking (TRN-04)', () => {
  it('device credentials are checked', async () => {
    const res = await device('wrong-key-wrong-key-wrong-key-00').ingest([{ recordedAt: ago(5), ...S1 }]);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('DEVICE_UNAUTHORIZED');
  });

  it('driver starts the pickup run; the bus nears stop 1 and its guardian gets one SMS', async () => {
    const trip = await as('driver').post('/api/v1/trn/trips/start').send({ routeId: ids.route, direction: 'pickup' });
    expect(trip.status, JSON.stringify(trip.body)).toBe(200);
    expect(trip.body.data).toMatchObject({ direction: 'pickup', resumed: false, vehicleId: ids.vehicle });
    ids.trip = trip.body.data.id;
    const again = await as('driver').post('/api/v1/trn/trips/start').send({ routeId: ids.route, direction: 'pickup' });
    expect(again.body.data).toMatchObject({ id: ids.trip, resumed: true });

    const batch = [
      { recordedAt: ago(60), lat: S1.lat - 0.018, lng: S1.lng, speedKmh: 32, heading: 0 }, // 2 km south
      { recordedAt: ago(40), lat: S1.lat - 0.003, lng: S1.lng, speedKmh: 24, heading: 0 }, // ~330 m: near
      { recordedAt: ago(20), lat: S1.lat - 0.0001, lng: S1.lng, speedKmh: 2, heading: 0 }, // at the stop
      { recordedAt: ago(10), lat: 0, lng: 0 }, // no GPS fix: rejected
    ];
    const res = await device().ingest(batch);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ accepted: 3, stored: 3, rejected: 1, tripId: ids.trip, nearStops: [ids.s1] });
    const replay = await device().ingest(batch);
    expect(replay.body.data).toMatchObject({ stored: 0, nearStops: [] });

    await drainOutbox();
    const sms = await t.owner.query<{ recipient_address: string; body: string }>(
      `SELECT recipient_address, body FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
      [`trn.bus_near:${ids.trip}:${ids.s1}`],
    );
    expect(sms).toHaveLength(1);
    expect(sms[0]!.recipient_address).toBe(ids.phoneA);
    expect(sms[0]!.body).toContain(`Gulshan 1 ${run}`);
  });

  it('live fleet: status, trip and next stop with ETA', async () => {
    const live = await as('transport').get(`/api/v1/trn/tracking/live?campusId=${ids.dhn}`);
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    const bus = live.body.data.find((v: { vehicleId: string }) => v.vehicleId === ids.vehicle);
    expect(bus).toMatchObject({
      status: 'idle',
      lastSeenSec: 20,
      trip: { id: ids.trip, direction: 'pickup' },
      nextStop: { stopId: ids.s2 },
      position: { source: 'device' },
    });
    expect(bus.nextStop.distanceMeters).toBeGreaterThan(1500);
    expect(bus.nextStop.etaMinutes).toBeGreaterThan(0);
  });

  it('driver app fixes; overspeed raises one alert per 10 minutes', async () => {
    clock.set(new Date(START.getTime() + 60_000));
    const fast = (sec: number, lat: number) => ({ recordedAt: ago(sec), lat, lng: S1.lng - 0.002, speedKmh: 85 });
    const r1 = await as('driver')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/pings`)
      .send({ pings: [fast(10, S1.lat + 0.004)] });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.data.alerts).toEqual(['overspeed']);
    const r2 = await as('driver')
      .post(`/api/v1/trn/vehicles/${ids.vehicle}/pings`)
      .send({ pings: [fast(5, S1.lat + 0.006)] });
    expect(r2.body.data.alerts).toEqual([]);

    const alerts = await as('transport').get(`/api/v1/trn/alerts?campusId=${ids.dhn}&open=true`);
    const mine = alerts.body.data.filter((a: { vehicleId: string }) => a.vehicleId === ids.vehicle);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'overspeed', details: { speedKmh: 85, limitKmh: 60 } });
    const ack = await as('transport').post(`/api/v1/trn/alerts/${mine[0].id}/acknowledge`).send();
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
  });

  it('a phone running Traccar Client (OsmAnd protocol) is a tracker too', async () => {
    const ts = Math.floor((clock.now().getTime() - 2_000) / 1000);
    const res = await request(t.app).get(
      `/api/v1/trn/gps/osmand?id=${ids.deviceId}.${ids.deviceKey}&lat=${S2.lat - 0.004}&lon=${S2.lng}&timestamp=${ts}&speed=10&bearing=45`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ stored: 1 });
    const live = await as('transport').get(`/api/v1/trn/tracking/live?campusId=${ids.dhn}`);
    const bus = live.body.data.find((v: { vehicleId: string }) => v.vehicleId === ids.vehicle);
    expect(bus.position).toMatchObject({ speedKmh: 18.5, heading: 45 });
  });

  it("guardian sees their own child's bus only", async () => {
    tokens.guardianA = await guardianLogin(ids.phoneA!);
    const mine = await as('guardianA').get(`/api/v1/trn/students/${ids.studentA}/bus`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data).toMatchObject({
      stop: { id: ids.s1, pickupTime: '07:10:00' },
      trip: { id: ids.trip },
      progress: { reached: true },
      driver: { name: 'Karim Driver' },
    });
    const other = await as('guardianA').get(`/api/v1/trn/students/${ids.studentB}/bus`);
    expect(other.status).toBe(404);

    const desk = await as('transport').get(`/api/v1/trn/students/${ids.studentB}/bus`);
    expect(desk.body.data.stop.id).toBe(ids.s2);
    expect(desk.body.data.progress).toMatchObject({ reached: false });
    expect(desk.body.data.progress.etaMinutes).toBeGreaterThan(0);
  });

  it('history polyline, then offline after silence and the run ends', async () => {
    const track = await as('transport').get(
      `/api/v1/trn/vehicles/${ids.vehicle}/track?from=${encodeURIComponent(new Date(START.getTime() - 3_600_000).toISOString())}&to=${encodeURIComponent(clock.now().toISOString())}`,
    );
    expect(track.status, JSON.stringify(track.body)).toBe(200);
    expect(track.body.data.totalPoints).toBe(6);
    expect(track.body.data.distanceMeters).toBeGreaterThan(2500);

    clock.set(new Date(START.getTime() + 15 * 60_000));
    const live = await as('transport').get(`/api/v1/trn/tracking/live?campusId=${ids.dhn}`);
    expect(live.body.data.find((v: { vehicleId: string }) => v.vehicleId === ids.vehicle).status).toBe('offline');

    const end = await as('driver').post(`/api/v1/trn/trips/${ids.trip}/end`).send();
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    const after = await device().ingest([{ recordedAt: ago(1), ...S2 }]);
    expect(after.body.data.tripId).toBeNull();
  });

  it('live fleet stream (Server-Sent Events)', async () => {
    const server = t.app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const first = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          {
            port,
            path: `/api/v1/trn/tracking/stream?campusId=${ids.dhn}&intervalSec=2`,
            headers: { Authorization: `Bearer ${tokens.transport}` },
          },
          (res) => {
            expect(res.headers['content-type']).toContain('text/event-stream');
            let buf = '';
            res.on('data', (chunk: Buffer) => {
              buf += chunk.toString('utf8');
              if (buf.includes('event: update')) {
                req.destroy();
                resolve(buf);
              }
            });
          },
        );
        req.on('error', (e) =>
          e.message.includes('aborted') || e.message.includes('socket hang up') ? undefined : reject(e),
        );
      });
      const data = JSON.parse(/event: update\ndata: (.*)\n/.exec(first)![1]!);
      expect(data.map((v: { vehicleId: string }) => v.vehicleId)).toContain(ids.vehicle);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
