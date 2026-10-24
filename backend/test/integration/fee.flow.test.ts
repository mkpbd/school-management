/**
 * End-to-end through HTTP: fee structure -> concessions -> billing run -> counter payments (cash session) ->
 * receipts / SMS -> family statement -> void rules. Fixed clock in the 2091 test year (see academic.flow.test.ts).
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
const PERIOD = '2091-03';
const TUITION = 500_000; // Tk 5,000.00
const ADMISSION = 1_000_000; // Tk 10,000.00

let SCHOOL_DAY = LocalDate.parse('2091-03-01');
while (![0, 1, 2, 3, 4].includes(SCHOOL_DAY.dayOfWeek())) SCHOOL_DAY = SCHOOL_DAY.addDays(1);

const clock = new FixedClock(new Date(`${SCHOOL_DAY.iso}T03:00:00Z`));
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const invoices: Record<string, { id: string; netPaisa: number }> = {};

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

const smsFor = (dedupeKeys: string[]) =>
  eventually(
    () =>
      t.owner.query<{ event_code: string; body: string }>(
        `SELECT event_code, body FROM com.outbound_message WHERE dedupe_key = ANY($1::text[]) AND channel = 'sms' ORDER BY created_at`,
        [dedupeKeys],
      ),
    (rows) => rows.length >= dedupeKeys.length,
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
  const heads = await t.owner.query<{ id: string; code: string }>(
    `SELECT id, code FROM fee.fee_head WHERE org_id = $1 AND code IN ('TUITION', 'ADMISSION', 'LIB_FINE')`,
    [orgId],
  );
  for (const h of heads) ids[h.code] = h.id;
  const types = await t.owner.query<{ id: string; code: string }>(
    `SELECT id, code FROM fee.concession_type WHERE org_id = $1 AND code IN ('SIBLING', 'MERIT')`,
    [orgId],
  );
  for (const c of types) ids[c.code] = c.id;

  for (const [who, roleCode] of [
    ['coord', 'ACADEMIC_COORDINATOR'],
    ['accountant', 'ACCOUNTANT'],
    ['cashier', 'CASHIER'],
  ] as const) {
    const u = await t.owner.createStaffUser({ password: PASSWORD, roleCode, campusCode: 'DHN' });
    tokens[who] = await login(u.username);
  }

  // a Year 8 section with two siblings (one family, one fee payer)
  const section = await as('coord')
    .post('/api/v1/aca/sections')
    .send({
      campusId: ids.dhn,
      academicYearId: ids.year,
      yearGroupId: ids.y8,
      name: `F${run}`,
      displayName: `Year 8 - F (${run})`,
      capacity: 30,
    });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  const phone = `+88019${String(Date.now()).slice(-8)}`;
  for (const [key, first] of [
    ['studentA', 'Nabil'],
    ['studentB', 'Tasnia'],
  ] as const) {
    const res = await as('coord')
      .post('/api/v1/sis/students')
      .send({
        campusId: ids.dhn,
        student: {
          firstNameEn: first,
          lastNameEn: 'Payer',
          gender: 'male',
          dateOfBirth: '2078-02-01',
          admittedOn: SCHOOL_DAY.iso,
        },
        guardians: [
          {
            fullNameEn: 'Fee Payer',
            phone,
            relationship: 'father',
            preferredLocale: 'en',
            isPrimaryContact: true,
            isFeePayer: true,
          },
        ],
        enrolment: { classSectionId: section.body.data.id },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[key] = res.body.data.student.id;
    ids.family = res.body.data.student.familyId;
  }
});

afterAll(async () => {
  await t.close();
});

describe('set-up (FEE-01, FEE-02)', () => {
  it('accountant creates and activates the Year 8 fee structure', async () => {
    const res = await as('accountant')
      .post('/api/v1/fee/structures')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y8,
        name: `Year 8 fees ${run}`,
        lines: [
          {
            feeHeadId: ids.TUITION,
            amountPaisa: TUITION,
            billingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            dueDay: 10,
          },
          { feeHeadId: ids.ADMISSION, amountPaisa: ADMISSION, billingMonths: null, appliesTo: 'new_admission' },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft' });
    expect(res.body.data.lines).toHaveLength(2);
    const act = await as('accountant').post(`/api/v1/fee/structures/${res.body.data.id}/activate`).send();
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(act.body.data.status).toBe('active');

    const dup = await as('accountant')
      .post('/api/v1/fee/structures')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        yearGroupId: ids.y8,
        name: 'dup',
        lines: [
          { feeHeadId: ids.TUITION, amountPaisa: 1 },
          { feeHeadId: ids.TUITION, amountPaisa: 2 },
        ],
      });
    expect(dup.body.code).toBe('DUPLICATE_FEE_HEAD');
  });

  it('concessions: sibling is automatic, merit waits for approval', async () => {
    const sibling = await as('accountant').post('/api/v1/fee/concessions').send({
      studentId: ids.studentB,
      concessionTypeId: ids.SIBLING,
      valuePercent: 10,
      validFrom: '2091-01-01',
      validTo: '2091-12-31',
    });
    expect(sibling.status, JSON.stringify(sibling.body)).toBe(201);
    expect(sibling.body.data.status).toBe('approved');

    const merit = await as('accountant').post('/api/v1/fee/concessions').send({
      studentId: ids.studentA,
      concessionTypeId: ids.MERIT,
      valuePercent: 25,
      validFrom: '2091-01-01',
      validTo: '2091-12-31',
      justification: 'Top of class',
    });
    expect(merit.body.data.status).toBe('pending');
    const bad = await as('accountant').post('/api/v1/fee/concessions').send({
      studentId: ids.studentA,
      concessionTypeId: ids.MERIT,
      valuePaisa: 100,
      validFrom: '2091-01-01',
      validTo: '2091-12-31',
    });
    expect(bad.body.code).toBe('CONCESSION_VALUE_INVALID');

    const decide = await as('accountant')
      .post(`/api/v1/fee/concessions/${merit.body.data.id}/decide`)
      .send({ decision: 'approved' });
    expect(decide.status, JSON.stringify(decide.body)).toBe(200);
    const again = await as('accountant')
      .post(`/api/v1/fee/concessions/${merit.body.data.id}/decide`)
      .send({ decision: 'rejected' });
    expect(again.body.code).toBe('CONCESSION_ALREADY_DECIDED');
  });
});

describe('billing (FEE-03)', () => {
  it('preview, post, and re-post never double-bills', async () => {
    const body = { campusId: ids.dhn, academicYearId: ids.year, period: PERIOD };
    const preview = await as('accountant').post('/api/v1/fee/billing/preview').send(body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    // the shared test year collects students from other files, so A and B may fall outside the 20-row sample;
    // their invoices are checked after posting
    expect(preview.body.data.invoices).toBeGreaterThanOrEqual(2);
    expect(preview.body.data.sample.length).toBeLessThanOrEqual(20);

    const post = await as('accountant').post('/api/v1/fee/billing-runs').send(body);
    expect(post.status, JSON.stringify(post.body)).toBe(201);
    expect(post.body.data.invoices).toBeGreaterThanOrEqual(2);

    const list = await as('accountant').get(`/api/v1/fee/invoices?familyId=${ids.family}&period=${PERIOD}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    for (const inv of list.body.data) invoices[inv.studentId === ids.studentA ? 'A' : 'B'] = inv;
    // A: tuition less 25 % merit + admission; B: tuition less 10 % sibling + admission
    expect(invoices.A!.netPaisa).toBe(TUITION * 0.75 + ADMISSION);
    expect(invoices.B!.netPaisa).toBe(TUITION * 0.9 + ADMISSION);
    expect(list.body.data[0]).toMatchObject({ status: 'issued', dueDate: `${PERIOD}-10` });

    const detail = await as('accountant').get(`/api/v1/fee/invoices/${invoices.A!.id}`);
    expect(detail.body.data.lines).toHaveLength(2);
    expect(detail.body.data.invoiceNo).toMatch(/^INV-DHN-/);

    const repost = await as('accountant').post('/api/v1/fee/billing-runs').send(body);
    expect(repost.status, JSON.stringify(repost.body)).toBe(201);
    expect(repost.body.data.skipped.alreadyBilled).toBeGreaterThanOrEqual(2);
    const after = await as('accountant').get(`/api/v1/fee/invoices?familyId=${ids.family}&period=${PERIOD}`);
    expect(after.body.data).toHaveLength(2);

    await drainOutbox();
    const sms = await smsFor([`fee.invoice_issued:${invoices.A!.id}`, `fee.invoice_issued:${invoices.B!.id}`]);
    expect(sms).toHaveLength(2);
    expect(sms.map((m) => m.body).join(' ')).toContain('/pay/');
  });
});

describe('collection (FEE-05, FEE-06)', () => {
  it('cash needs an open session; payment allocates oldest due, then head priority', async () => {
    const pay = { campusId: ids.dhn, familyId: ids.family, amountPaisa: ADMISSION, channel: 'cash' };
    const noSession = await as('cashier').post('/api/v1/fee/payments/counter').send(pay);
    expect(noSession.body.code).toBe('CASH_SESSION_REQUIRED');

    const session = await as('cashier')
      .post('/api/v1/fee/cash-sessions')
      .send({ campusId: ids.dhn, openingFloatPaisa: 50_000 });
    expect(session.status, JSON.stringify(session.body)).toBe(201);
    ids.session = session.body.data.id;
    const second = await as('cashier').post('/api/v1/fee/cash-sessions').send({ campusId: ids.dhn });
    expect(second.body.code).toBe('CASH_SESSION_OPEN');

    const res = await as('cashier').post('/api/v1/fee/payments/counter').send(pay);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ amountPaisa: ADMISSION, allocatedPaisa: ADMISSION, creditPaisa: 0 });
    expect(res.body.data.receiptNo).toMatch(/^RCP-DHN-/);
    // both invoices are due the same day: admission (priority 30) before tuition (100) -> one admission line paid
    expect(res.body.data.allocations).toHaveLength(1);
    ids.cashPayment = res.body.data.paymentId;

    await drainOutbox();
    const [sms] = await smsFor([`fee.payment_received:${ids.cashPayment}`]);
    expect(sms!.body).toContain(res.body.data.receiptNo);
    expect(sms!.body).toContain('10,000.00');
  });

  it('over-payment by cheque settles everything and leaves family credit', async () => {
    const outstanding = invoices.A!.netPaisa + invoices.B!.netPaisa - ADMISSION;
    const res = await as('cashier')
      .post('/api/v1/fee/payments/counter')
      .send({
        campusId: ids.dhn,
        familyId: ids.family,
        amountPaisa: outstanding + 100_000,
        channel: 'cheque',
        instrument: { chequeNo: '004512', bank: 'DBBL' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ allocatedPaisa: outstanding, creditPaisa: 100_000 });

    const paid = await as('cashier').get(`/api/v1/fee/invoices?familyId=${ids.family}&status=paid`);
    expect(paid.body.data.map((i: { id: string }) => i.id).sort()).toEqual([invoices.A!.id, invoices.B!.id].sort());
    const nothingLeft = await as('cashier')
      .post('/api/v1/fee/payments/counter')
      .send({
        campusId: ids.dhn,
        familyId: ids.family,
        invoiceIds: [invoices.A!.id],
        amountPaisa: 100,
        channel: 'pos_card',
      });
    expect(nothingLeft.body.code).toBe('INVOICE_NOT_PAYABLE');
  });

  it('void rules: paid invoice refused, ad-hoc unpaid invoice voided', async () => {
    const paid = await as('accountant').post(`/api/v1/fee/invoices/${invoices.A!.id}/void`).send({ reason: 'mistake' });
    expect(paid.body.code).toBe('INVOICE_HAS_PAYMENTS');

    const adhoc = await as('accountant')
      .post('/api/v1/fee/invoices')
      .send({
        studentId: ids.studentA,
        dueDate: '2091-03-20',
        lines: [{ feeHeadId: ids.LIB_FINE, description: 'Lost book', amountPaisa: 35_000 }],
      });
    expect(adhoc.status, JSON.stringify(adhoc.body)).toBe(201);
    expect(adhoc.body.data).toMatchObject({ status: 'issued', netPaisa: 35_000, billingPeriod: null });
    const voided = await as('accountant')
      .post(`/api/v1/fee/invoices/${adhoc.body.data.id}/void`)
      .send({ reason: 'Book found' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(voided.body.data.status).toBe('void');
    const twice = await as('accountant')
      .post(`/api/v1/fee/invoices/${adhoc.body.data.id}/void`)
      .send({ reason: 'again' });
    expect(twice.body.code).toBe('INVOICE_ALREADY_VOID');
  });

  it('family statement: nothing outstanding, credit carried', async () => {
    const res = await as('accountant').get(`/api/v1/fee/families/${ids.family}/statement`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.data;
    expect(d.invoices).toHaveLength(2); // the void ad-hoc invoice is excluded
    expect(d.payments).toHaveLength(2);
    expect(d.totals).toMatchObject({
      netPaisa: invoices.A!.netPaisa + invoices.B!.netPaisa,
      outstandingPaisa: 0,
      overduePaisa: 0,
      creditPaisa: 100_000,
    });
  });

  it('closing the cash session reports variance (only cash counts)', async () => {
    const res = await as('cashier')
      .post(`/api/v1/fee/cash-sessions/${ids.session}/close`)
      .send({ countedCashPaisa: 1_049_000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ expectedCashPaisa: 1_050_000, countedCashPaisa: 1_049_000, variancePaisa: -1_000 });
    const again = await as('cashier')
      .post(`/api/v1/fee/cash-sessions/${ids.session}/close`)
      .send({ countedCashPaisa: 0 });
    expect(again.body.code).toBe('CASH_SESSION_CLOSED');
  });
});
