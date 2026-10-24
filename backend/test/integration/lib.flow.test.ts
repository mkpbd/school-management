/**
 * End-to-end through HTTP: catalogue -> copies -> issue / renew / reserve -> late return with fine billed through FEE
 * -> reservation hold + SMS -> overdue reminders -> lost book -> reader account -> stock-take -> e-library.
 * Fixed clock in the 2091 test year (see academic.flow.test.ts).
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
const PRICE = 80_000; // Tk 800.00
const FINE_PER_DAY = 500; // seeded student policy: Tk 5 per day

let SCHOOL_DAY = LocalDate.parse('2091-04-01');
while (![0, 1, 2, 3, 4].includes(SCHOOL_DAY.dayOfWeek())) SCHOOL_DAY = SCHOOL_DAY.addDays(1);
const at = (d: LocalDate) => new Date(`${d.iso}T03:00:00Z`); // 09:00 in Dhaka

const clock = new FixedClock(at(SCHOOL_DAY));
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const barcodes: Record<string, string> = {};

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
  t.owner.query<{ body: string; to_address: string }>(
    `SELECT body, recipient_address AS to_address FROM com.outbound_message WHERE dedupe_key = $1 AND channel = 'sms'`,
    [dedupeKey],
  );

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
  ids.y8 = y8!.id;
  // a stock-take left open by an aborted earlier run would block this one
  await t.owner.query(
    `UPDATE lib.stock_take SET status = 'completed', completed_on = started_on WHERE campus_id = $1 AND status = 'in_progress'`,
    [ids.dhn],
  );

  for (const [who, roleCode, campus] of [
    ['librarian', 'LIBRARIAN', 'DHN'],
    ['coord', 'ACADEMIC_COORDINATOR', 'DHN'],
    ['hr', 'HR', undefined],
    ['it', 'IT_ADMIN', undefined],
  ] as const) {
    const u = await t.owner.createStaffUser({ password: PASSWORD, roleCode, campusCode: campus });
    tokens[who] = await login(u.username);
  }

  // a Year 8 student (senior member) with a guardian
  const section = await as('coord')
    .post('/api/v1/aca/sections')
    .send({
      campusId: ids.dhn,
      academicYearId: ids.year,
      yearGroupId: ids.y8,
      name: `L${run}`,
      displayName: `Year 8 - L (${run})`,
      capacity: 30,
    });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  ids.guardianPhone = `+88018${String(Date.now()).slice(-8)}`;
  const student = await as('coord')
    .post('/api/v1/sis/students')
    .send({
      campusId: ids.dhn,
      student: {
        firstNameEn: 'Reader',
        lastNameEn: `Lib${run}`,
        gender: 'female',
        dateOfBirth: '2078-06-01',
        admittedOn: '2091-01-05',
      },
      guardians: [
        {
          fullNameEn: 'Library Guardian',
          phone: ids.guardianPhone,
          relationship: 'mother',
          preferredLocale: 'en',
          isPrimaryContact: true,
          isFeePayer: true,
        },
      ],
      enrolment: { classSectionId: section.body.data.id },
    });
  expect(student.status, JSON.stringify(student.body)).toBe(201);
  ids.student = student.body.data.student.id;

  // a teacher with a login (borrows as "teacher", self-service)
  ids.teacherPhone = `+88017${String(Date.now() + 7).slice(-8)}`;
  const staff = await as('hr')
    .post('/api/v1/hrm/staff')
    .send({
      campusId: ids.dhn,
      staffNo: `LT-${run}`,
      fullNameEn: 'Library Teacher',
      gender: 'male',
      phone: ids.teacherPhone,
      email: `lib.teacher.${run}@test.local`,
      staffType: 'teaching',
      joinedOn: '2090-01-01',
    });
  expect(staff.status, JSON.stringify(staff.body)).toBe(201);
  ids.staff = staff.body.data.id;
  const account = await as('it')
    .post(`/api/v1/hrm/staff/${ids.staff}/account`)
    .send({ username: `lib.teacher.${run}`, password: PASSWORD, roleCode: 'CLASS_TEACHER', campusId: ids.dhn });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  tokens.teacher = await login(`lib.teacher.${run}`);
});

afterAll(async () => {
  await t.close();
});

describe('catalogue (LIB-01)', () => {
  it('policies are seeded per member type', async () => {
    const res = await as('librarian').get('/api/v1/lib/policies');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((p: { memberType: string }) => p.memberType).sort()).toEqual([
      'staff',
      'student_junior',
      'student_senior',
      'teacher',
    ]);
  });

  it('librarian catalogues titles and accessions copies', async () => {
    const title = await as('librarian')
      .post('/api/v1/lib/titles')
      .send({
        title: `Physics Basics ${run}`,
        authors: ['H. C. Verma'],
        isbn: '978-81-7709-187-8',
        categoryCode: '530',
      });
    expect(title.status, JSON.stringify(title.body)).toBe(201);
    ids.title = title.body.data.id;
    const copies = await as('librarian')
      .post(`/api/v1/lib/titles/${ids.title}/copies`)
      .send({ campusId: ids.dhn, count: 2, shelfLocation: 'A-1', pricePaisa: PRICE });
    expect(copies.status, JSON.stringify(copies.body)).toBe(201);
    expect(copies.body.data).toHaveLength(2);
    expect(copies.body.data[0].accessionNo).toMatch(/^DHN-L\d{6}$/);
    expect(copies.body.data[0].barcode).toBe(copies.body.data[0].accessionNo);
    barcodes.c1 = copies.body.data[0].barcode;
    barcodes.c2 = copies.body.data[1].barcode;

    const rare = await as('librarian')
      .post('/api/v1/lib/titles')
      .send({ title: `Rare Atlas ${run}`, authors: ['Anon'] });
    ids.rare = rare.body.data.id;
    const rareCopy = await as('librarian')
      .post(`/api/v1/lib/titles/${ids.rare}/copies`)
      .send({ campusId: ids.dhn, barcodes: [`RARE-${run}`], pricePaisa: PRICE });
    expect(rareCopy.status, JSON.stringify(rareCopy.body)).toBe(201);
    barcodes.rare = `RARE-${run}`;

    const search = await as('teacher').get(`/api/v1/lib/catalogue?q=verma&campusId=${ids.dhn}`);
    expect(search.status, JSON.stringify(search.body)).toBe(200);
    const hit = search.body.data.find((x: { id: string }) => x.id === ids.title);
    expect(hit).toMatchObject({ copies: 2, available: 2, waiting: 0 });
    const detail = await as('teacher').get(`/api/v1/lib/titles/${ids.title}?campusId=${ids.dhn}`);
    expect(detail.body.data.copiesList.map((c: { status: string }) => c.status)).toEqual(['available', 'available']);
  });
});

describe('circulation (LIB-02, LIB-03, LIB-04)', () => {
  it('issues within the member policy; the same copy cannot go out twice', async () => {
    const res = await as('librarian')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.c1, borrowerType: 'student', borrowerId: ids.student });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      borrower: { memberType: 'student_senior' },
      activeLoans: 1,
      maxLoans: 3,
    });
    expect(LocalDate.parse(res.body.data.dueOn).isBefore(SCHOOL_DAY.addDays(14))).toBe(false);
    ids.loan1 = res.body.data.loanId;
    ids.due1 = res.body.data.dueOn;

    const again = await as('librarian')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.c1, borrowerType: 'staff', borrowerId: ids.staff });
    expect(again.body.code).toBe('COPY_NOT_AVAILABLE');

    const rare = await as('librarian')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.rare, borrowerType: 'student', borrowerId: ids.student });
    expect(rare.status, JSON.stringify(rare.body)).toBe(201);
    ids.rareLoan = rare.body.data.loanId;
    ids.rareDue = rare.body.data.dueOn;

    const teacherIssue = await as('teacher')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.c2, borrowerType: 'staff', borrowerId: ids.staff });
    expect(teacherIssue.status).toBe(403);
  });

  it('reservations: only when nothing is on the shelf, once per reader', async () => {
    const shelf = await as('teacher').post('/api/v1/lib/reservations').send({ titleId: ids.title });
    expect(shelf.body.code).toBe('COPY_AVAILABLE');

    const res = await as('teacher').post('/api/v1/lib/reservations').send({ titleId: ids.rare });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.position).toBe(1);
    ids.reservation = res.body.data.reservationId;
    const twice = await as('librarian')
      .post('/api/v1/lib/reservations')
      .send({ titleId: ids.rare, borrowerType: 'staff', borrowerId: ids.staff });
    expect(twice.body.code).toBe('ALREADY_RESERVED');
  });

  it('renewal: blocked while someone waits, limited by the policy', async () => {
    const waiting = await as('librarian').post(`/api/v1/lib/loans/${ids.rareLoan}/renew`).send();
    expect(waiting.body.code).toBe('RESERVED_BY_OTHERS');
    const ok = await as('librarian').post(`/api/v1/lib/loans/${ids.loan1}/renew`).send();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.renewCount).toBe(1);
    ids.due1 = ok.body.data.dueOn;
    const limit = await as('librarian').post(`/api/v1/lib/loans/${ids.loan1}/renew`).send();
    expect(limit.body.code).toBe('RENEWAL_LIMIT_REACHED');
    const notMine = await as('teacher').post(`/api/v1/lib/loans/${ids.loan1}/renew`).send();
    expect(notMine.status).toBe(404);
  });

  it('late return: fine billed to the family, copy held for the next reader who gets an SMS', async () => {
    const lateDay = LocalDate.parse(ids.rareDue!).addDays(3);
    clock.set(at(lateDay));
    const res = await as('librarian').post('/api/v1/lib/return').send({ barcode: barcodes.rare });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      overdueDays: 3,
      fine: { overduePaisa: 3 * FINE_PER_DAY, totalPaisa: 3 * FINE_PER_DAY, waived: false },
      copyStatus: 'reserved',
      heldForReservation: ids.reservation,
    });
    expect(res.body.data.feeInvoiceNo).toMatch(/^INV-DHN-/);
    const [line] = await t.owner.query<{ net_paisa: string; status: string }>(
      `SELECT l.net_paisa, i.status FROM fee.invoice_line l JOIN fee.invoice i ON i.id = l.invoice_id
        WHERE l.source = 'library' AND l.source_ref = $1`,
      [`lib:${ids.rareLoan}`],
    );
    expect(Number(line!.net_paisa)).toBe(3 * FINE_PER_DAY);
    expect(line!.status).toBe('issued');

    const notReturned = await as('librarian').post('/api/v1/lib/return').send({ barcode: barcodes.rare });
    expect(notReturned.body.code).toBe('COPY_NOT_ON_LOAN');

    await drainOutbox();
    const [ready] = await sms(`lib.reservation_ready:${ids.reservation}`);
    expect(ready!.body).toContain('Rare Atlas');
    expect(ready!.to_address).toBe(ids.teacherPhone);
  });

  it('held copy goes only to the reserving reader; overdue readers are blocked', async () => {
    const blocked = await as('librarian')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.rare, borrowerType: 'student', borrowerId: ids.student });
    expect(blocked.body.code).toBe('BORROWER_HAS_OVERDUE');
    const res = await as('librarian')
      .post('/api/v1/lib/issue')
      .send({ barcode: barcodes.rare, borrowerType: 'staff', borrowerId: ids.staff });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ reservationFulfilled: ids.reservation, borrower: { memberType: 'teacher' } });
  });

  it('overdue reminders reach the guardian once per stage', async () => {
    const days = LocalDate.parse(ids.due1!).daysUntil(LocalDate.fromInstant(clock.now()));
    clock.set(at(LocalDate.parse(ids.due1!).addDays(7))); // a reminder stage (1, 3, 7, 14)
    try {
      const res = await as('librarian').post('/api/v1/lib/tasks/overdue-reminders').send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.reminded).toBeGreaterThanOrEqual(1);
      await as('librarian').post('/api/v1/lib/tasks/overdue-reminders').send();
      await drainOutbox();
      const msgs = await sms(`lib.loan_overdue:${ids.loan1}:7`);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.to_address).toBe(ids.guardianPhone);
      expect(msgs[0]!.body).toContain('7 days late');
    } finally {
      clock.set(at(LocalDate.parse(ids.due1!).addDays(Math.max(days, 0))));
    }
  });

  it('lost book: replacement + overdue fine; reader account totals', async () => {
    const days = LocalDate.parse(ids.due1!).daysUntil(LocalDate.fromInstant(clock.now()));
    const res = await as('librarian').post('/api/v1/lib/return').send({ barcode: barcodes.c1, condition: 'lost' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      overdueDays: days,
      fine: { overduePaisa: days * FINE_PER_DAY, replacementPaisa: PRICE },
      copyStatus: 'lost',
    });

    const account = await as('librarian').get(`/api/v1/lib/borrowers/student/${ids.student}`);
    expect(account.status, JSON.stringify(account.body)).toBe(200);
    expect(account.body.data.totals).toMatchObject({
      active: 0,
      overdue: 0,
      finesPaisa: 3 * FINE_PER_DAY + days * FINE_PER_DAY + PRICE,
    });
    expect(account.body.data.history).toHaveLength(2);
    const outsider = await as('teacher').get(`/api/v1/lib/borrowers/student/${ids.student}`);
    expect(outsider.status).toBe(404);
  });

  it('teacher self-service: own account and renewal', async () => {
    const me = await as('teacher').get('/api/v1/lib/me');
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.data.borrower).toMatchObject({ type: 'staff', id: ids.staff, memberType: 'teacher' });
    expect(me.body.data.activeLoans).toHaveLength(1);
    const renew = await as('teacher').post(`/api/v1/lib/loans/${me.body.data.activeLoans[0].id}/renew`).send();
    expect(renew.status, JSON.stringify(renew.body)).toBe(200);
  });
});

describe('stock-take (LIB-05) and e-library (LIB-06)', () => {
  it('scans, reports missing / unexpected copies and recovers a found "lost" copy', async () => {
    const st = await as('librarian').post('/api/v1/lib/stock-takes').send({ campusId: ids.dhn });
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    const second = await as('librarian').post('/api/v1/lib/stock-takes').send({ campusId: ids.dhn });
    expect(second.body.code).toBe('STOCK_TAKE_IN_PROGRESS');

    const scan = await as('librarian')
      .post(`/api/v1/lib/stock-takes/${st.body.data.id}/scans`)
      .send({ barcodes: [barcodes.c2, barcodes.c1, `NOPE-${run}`] });
    expect(scan.body.data).toEqual({ scanned: 2, alreadyScanned: 0, unknown: [`NOPE-${run}`] });
    const rescan = await as('librarian')
      .post(`/api/v1/lib/stock-takes/${st.body.data.id}/scans`)
      .send({ barcodes: [barcodes.c2] });
    expect(rescan.body.data).toMatchObject({ scanned: 0, alreadyScanned: 1 });

    const report = await as('librarian').get(`/api/v1/lib/stock-takes/${st.body.data.id}`);
    expect(report.status).toBe(200);
    const missingIds = report.body.data.missing.map((m: { accessionNo: string }) => m.accessionNo);
    expect(missingIds).not.toContain(barcodes.c2);
    expect(report.body.data.unexpected.map((u: { accessionNo: string }) => u.accessionNo)).toContain(barcodes.c1);

    const done = await as('librarian').post(`/api/v1/lib/stock-takes/${st.body.data.id}/complete`).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.recovered).toBe(1);
    const detail = await as('librarian').get(`/api/v1/lib/titles/${ids.title}?campusId=${ids.dhn}`);
    expect(detail.body.data.available).toBe(2);
  });

  it('digital items: https links only, listed for teachers', async () => {
    const insecure = await as('librarian')
      .post('/api/v1/lib/digital-items')
      .send({ title: 'Old paper', kind: 'past_paper', url: 'http://example.org/p.pdf' });
    expect(insecure.body.code).toBe('URL_INSECURE');
    const ok = await as('librarian')
      .post('/api/v1/lib/digital-items')
      .send({
        title: `Past paper ${run}`,
        kind: 'past_paper',
        url: 'https://example.org/p.pdf',
        yearGroupIds: [ids.y8],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const list = await as('teacher').get(`/api/v1/lib/digital-items?q=${run}`);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(ok.body.data.id);
  });
});
