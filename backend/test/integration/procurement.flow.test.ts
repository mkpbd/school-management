/**
 * Budget & procurement end-to-end: budget with maker-checker approval and revision; vendors; library requisition ->
 * approval with budget check -> quotations compared -> PO at the quoted price -> partial and late goods receipts ->
 * supplier bills (three-way match, VAT / TDS withheld, journals) -> payments -> payables aging; budget vs actual;
 * a second requisition beyond the budget needs an overrun approval; vendor performance.
 * Fixed clock in a dedicated test year (2093).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const YEAR_CODE = 'TEST-2093';
const clock = new FixedClock(new Date('2093-03-10T04:00:00Z')); // 10:00 Dhaka
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
  put: (url: string) =>
    request(t.app).put(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
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
  ids.dhn = await t.owner.campusId('DHN');
  const [year] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES ($1, $2, '2093-01-01', '2093-12-31', 'open')
     ON CONFLICT (org_id, code) DO UPDATE SET status = 'open' RETURNING id`,
    [orgId, YEAR_CODE],
  );
  ids.year = year!.id;
  // earlier runs approved budgets and ordered against this year: retire them
  await t.owner.query(`UPDATE acc.budget SET status = 'closed' WHERE academic_year_id = $1`, [ids.year]);
  await t.owner.query(
    `UPDATE acc.purchase_order SET status = 'closed' WHERE order_date BETWEEN '2093-01-01' AND '2093-12-31'`,
  );
  await t.owner.query(
    `UPDATE acc.journal_line l SET cost_centre_id = NULL FROM acc.journal j
      WHERE j.id = l.journal_id AND j.journal_date BETWEEN '2093-01-01' AND '2093-12-31'`,
  );
  for (const code of ['5250', '5240']) {
    const [a] = await t.owner.query<{ id: string }>(`SELECT id FROM acc.account WHERE org_id = $1 AND code = $2`, [
      orgId,
      code,
    ]);
    ids[`acc${code}`] = a!.id;
  }
  const [cc] = await t.owner.query<{ id: string }>(
    `SELECT id FROM acc.cost_centre WHERE org_id = $1 AND code = 'LIB'`,
    [orgId],
  );
  ids.lib = cc!.id;

  for (const [who, role, campus] of [
    ['accountant', 'ACCOUNTANT', 'DHN'],
    ['principal', 'PRINCIPAL', undefined],
    ['librarian', 'LIBRARIAN', 'DHN'],
  ] as const) {
    const u = await t.owner.createStaffUser({
      password: PASSWORD,
      roleCode: role,
      ...(campus ? { campusCode: campus } : {}),
    });
    ids[`user_${who}`] = u.id;
    tokens[who] = await login(u.username);
  }
});

afterAll(async () => {
  await t.close();
});

describe('budget (ACC-03)', () => {
  it('accountant drafts and submits; approval is by someone else; a revision supersedes', async () => {
    const months = [0, 0, 500_000, 500_000, 500_000, 500_000, 0, 0, 500_000, 500_000, 500_000, 500_000];
    const draft = await as('accountant')
      .post('/api/v1/acc/budgets')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        name: `Library 2093 ${run}`,
        lines: [
          { accountId: ids.acc5250, costCentreId: ids.lib, annualPaisa: 12_000_000 },
          { accountId: ids.acc5240, costCentreId: ids.lib, months },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    ids.budget1 = draft.body.data.id;
    expect((await as('accountant').post(`/api/v1/acc/budgets/${ids.budget1}/submit`).send()).body.data.status).toBe(
      'submitted',
    );
    const self = await as('accountant')
      .post(`/api/v1/acc/budgets/${ids.budget1}/decide`)
      .send({ decision: 'approved' });
    expect(self.body.code).toBe('SELF_APPROVAL');
    const ok = await as('principal').post(`/api/v1/acc/budgets/${ids.budget1}/decide`).send({ decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const view = await as('accountant').get(`/api/v1/acc/budgets/${ids.budget1}`);
    expect(view.body.data.totalPaisa).toBe(16_000_000);
    expect(view.body.data.lines.find((l: { accountCode: string }) => l.accountCode === '5250').months[11]).toBe(
      1_000_000,
    );

    const rev = await as('accountant')
      .post('/api/v1/acc/budgets')
      .send({
        campusId: ids.dhn,
        academicYearId: ids.year,
        name: `Library 2093 rev ${run}`,
        revisionOfId: ids.budget1,
        lines: [
          { accountId: ids.acc5250, costCentreId: ids.lib, annualPaisa: 15_000_000 },
          { accountId: ids.acc5240, costCentreId: ids.lib, months },
        ],
      });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    ids.budget = rev.body.data.id;
    await as('accountant').post(`/api/v1/acc/budgets/${ids.budget}/submit`).send();
    expect(
      (await as('principal').post(`/api/v1/acc/budgets/${ids.budget}/decide`).send({ decision: 'approved' })).status,
    ).toBe(200);
    expect((await as('accountant').get(`/api/v1/acc/budgets/${ids.budget1}`)).body.data.status).toBe('superseded');
    const locked = await as('accountant')
      .put(`/api/v1/acc/budgets/${ids.budget}/lines`)
      .send({ lines: [{ accountId: ids.acc5250, annualPaisa: 1 }] });
    expect(locked.body.code).toBe('BUDGET_NOT_EDITABLE');
  });
});

describe('vendors (ACC-05)', () => {
  it('supplier master with BIN / TIN, VAT and TDS deduction rates and payment terms', async () => {
    const make = async (name: string, extra: Record<string, unknown> = {}) => {
      const res = await as('accountant')
        .post('/api/v1/acc/vendors')
        .send({ code: `${name.slice(0, 4).toUpperCase()}${run}`, name: `${name} ${run}`, ...extra });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.v1 = await make('Boibazar');
    ids.v2 = await make('Pathok Shamabesh', {
      tin: '123456789012',
      binVat: '000123456-0101',
      vatRatePct: 7.5,
      tdsRatePct: 5,
      paymentTermsDays: 30,
      phone: '+8801711000000',
    });
    ids.v3 = await make('Rokomari');
    const v = await as('accountant').get(`/api/v1/acc/vendors/${ids.v2}`);
    expect(v.body.data).toMatchObject({ vatRatePct: 7.5, tdsRatePct: 5, paymentTermsDays: 30 });
    expect((await as('librarian').get('/api/v1/acc/vendors')).status).toBe(403);
  });
});

describe('requisition -> quotations -> PO -> receipt -> bill -> payment (ACC-04)', () => {
  it('the library raises a requisition; approval checks the budget (not by the requester)', async () => {
    const pr = await as('librarian')
      .post('/api/v1/acc/requisitions')
      .send({
        title: 'IGCSE reference books',
        costCentreId: ids.lib,
        neededBy: '2093-04-15',
        justification: 'New syllabus from June',
        lines: [
          { description: 'Physics reference (Pearson)', quantity: 100, estUnitPaisa: 90_000, accountId: ids.acc5250 },
        ],
        submit: true,
      });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    expect(pr.body.data.prNo).toMatch(/^PR-DHN-93-\d{5}$/);
    ids.pr = pr.body.data.id;

    const preview = await as('principal').get(`/api/v1/acc/requisitions/${ids.pr}`);
    expect(preview.body.data).toMatchObject({ estimatedPaisa: 9_000_000, quotationsRequired: 3 });
    expect(preview.body.data.budgetCheck.overruns).toEqual([]);
    expect(
      (await as('librarian').post(`/api/v1/acc/requisitions/${ids.pr}/decide`).send({ decision: 'approved' })).status,
    ).toBe(403);
    const ok = await as('principal').post(`/api/v1/acc/requisitions/${ids.pr}/decide`).send({ decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'approved', overBudget: false });

    const told = await messages(`acc.requisition_decided:${ids.pr}:approved`);
    expect(told.map((m) => m.channel)).toEqual(expect.arrayContaining(['email', 'in_app']));
    expect(told.find((m) => m.channel === 'email')!.body).toContain('IGCSE reference books');

    const mine = await as('librarian').get('/api/v1/acc/requisitions');
    expect(mine.body.data.map((r: { id: string }) => r.id)).toEqual([ids.pr]);
  });

  it('quotations are compared; the cheapest wins unless there is a reason', async () => {
    const quote = (vendorId: string, totalPaisa: number, validUntil: string) =>
      as('accountant')
        .post(`/api/v1/acc/requisitions/${ids.pr}/quotations`)
        .send({ vendorId, totalPaisa, validUntil, deliveryDays: 7 });
    const q1 = await quote(ids.v1!, 8_700_000, '2093-04-30');
    expect(q1.status, JSON.stringify(q1.body)).toBe(201);
    ids.q1 = q1.body.data.id;
    ids.q2 = (await quote(ids.v2!, 8_500_000, '2093-04-30')).body.data.id;
    ids.q3 = (await quote(ids.v3!, 8_200_000, '2093-03-01')).body.data.id; // expired

    const early = await as('principal').post(`/api/v1/acc/requisitions/${ids.pr}/quotations/${ids.q2}/select`).send({});
    expect(early.body.code).toBe('QUOTATIONS_REQUIRED');
    await quote(ids.v3!, 9_100_000, '2093-04-30').then((r) => expect(r.status).toBe(409)); // one quote per vendor
    await t.owner.query(`UPDATE acc.quotation SET valid_until = '2093-04-30', total_paisa = 9100000 WHERE id = $1`, [
      ids.q3,
    ]);

    const pricier = await as('principal')
      .post(`/api/v1/acc/requisitions/${ids.pr}/quotations/${ids.q1}/select`)
      .send({});
    expect(pricier.body.code).toBe('REASON_REQUIRED');
    const pick = await as('principal').post(`/api/v1/acc/requisitions/${ids.pr}/quotations/${ids.q2}/select`).send({});
    expect(pick.status, JSON.stringify(pick.body)).toBe(200);
    expect(pick.body.data[0]).toMatchObject({ id: ids.q2, rank: 1, lowest: true, isSelected: true });
  });

  it('PO at the quoted price; the budget shows the commitment', async () => {
    const wrong = await as('accountant')
      .post(`/api/v1/acc/requisitions/${ids.pr}/purchase-order`)
      .send({
        lines: [{ description: 'Physics reference', quantity: 100, unitPaisa: 86_000, accountId: ids.acc5250 }],
      });
    expect(wrong.body.code).toBe('QUOTATION_MISMATCH');
    const po = await as('accountant')
      .post(`/api/v1/acc/requisitions/${ids.pr}/purchase-order`)
      .send({
        expectedOn: '2093-03-17',
        terms: 'Delivery to Dhanmondi library',
        lines: [
          { description: 'Physics reference (Pearson)', quantity: 100, unitPaisa: 85_000, accountId: ids.acc5250 },
        ],
      });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    expect(po.body.data).toMatchObject({ vendorId: ids.v2, totalPaisa: 8_500_000, status: 'issued' });
    ids.po = po.body.data.id;
    ids.poLine = po.body.data.lines[0].id;
    expect((await as('accountant').get(`/api/v1/acc/requisitions/${ids.pr}`)).body.data.status).toBe('ordered');

    const bva = await as('accountant').get(`/api/v1/acc/budgets/${ids.budget}/vs-actual?asOf=2093-03-31`);
    const books = bva.body.data.rows.find((r: { accountCode: string }) => r.accountCode === '5250');
    expect(books).toMatchObject({
      annualBudgetPaisa: 15_000_000,
      budgetToDatePaisa: 3_750_000,
      actualPaisa: 0,
      committedPaisa: 8_500_000,
      availablePaisa: 6_500_000,
    });
  });

  it('partial receipt on time, bill matched to it with VAT / TDS withheld and posted', async () => {
    const over = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${ids.po}/receipts`)
      .send({ lines: [{ poLineId: ids.poLine, quantity: 101 }] });
    expect(over.body.code).toBe('OVER_RECEIPT');
    const grn = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${ids.po}/receipts`)
      .send({ lines: [{ poLineId: ids.poLine, quantity: 60 }], rating: 4 });
    expect(grn.status, JSON.stringify(grn.body)).toBe(201);
    expect(grn.body.data).toMatchObject({ onTime: true, poStatus: 'partially_received' });

    const tooMuch = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${ids.po}/bills`)
      .send({ billNo: `PS-${run}-1`, lines: [{ poLineId: ids.poLine, quantity: 70 }] });
    expect(tooMuch.body.code).toBe('NOT_RECEIVED');
    const bill = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${ids.po}/bills`)
      .send({ billNo: `PS-${run}-1` });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.data).toMatchObject({
      grossPaisa: 5_100_000,
      vatPaisa: 382_500,
      tdsPaisa: 255_000,
      netPayablePaisa: 4_462_500,
      dueDate: '2093-04-09',
      status: 'open',
    });
    ids.bill1 = bill.body.data.id;
    const dup = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${ids.po}/bills`)
      .send({ billNo: `PS-${run}-1` });
    expect(dup.body.code).toBe('NOTHING_TO_BILL');

    const j = await as('accountant').get(`/api/v1/acc/journals/${bill.body.data.journalId}`);
    const lines = Object.fromEntries(
      j.body.data.lines.map((l: { accountCode: string; debitPaisa: number; creditPaisa: number }) => [
        l.accountCode,
        l.debitPaisa - l.creditPaisa,
      ]),
    );
    expect(lines).toEqual({ '5250': 5_100_000, '2300': -4_462_500, '2130': -382_500, '2120': -255_000 });
  });

  it('late remainder, second bill closes the order; payments in part and in full', async () => {
    clock.set(new Date('2093-03-25T04:00:00Z'));
    try {
      const grn = await as('accountant')
        .post(`/api/v1/acc/purchase-orders/${ids.po}/receipts`)
        .send({ lines: [{ poLineId: ids.poLine, quantity: 40 }], rating: 2, note: 'A week late, two damaged covers' });
      expect(grn.body.data).toMatchObject({ onTime: false, poStatus: 'received' });
      const bill2 = await as('accountant')
        .post(`/api/v1/acc/purchase-orders/${ids.po}/bills`)
        .send({ billNo: `PS-${run}-2` });
      expect(bill2.status, JSON.stringify(bill2.body)).toBe(201);
      ids.bill2 = bill2.body.data.id;
      expect((await as('accountant').get(`/api/v1/acc/purchase-orders/${ids.po}`)).body.data.status).toBe('billed');

      const part = await as('principal')
        .post(`/api/v1/acc/supplier-bills/${ids.bill1}/payments`)
        .send({ amountPaisa: 2_000_000, method: 'bank', reference: 'CHQ 556677' });
      expect(part.status, JSON.stringify(part.body)).toBe(201);
      expect(part.body.data.bill).toMatchObject({ paidPaisa: 2_000_000, status: 'partially_paid' });
      expect(part.body.data.payment.paymentNo).toMatch(/^SPY-DHN-93-/);
      const over = await as('principal')
        .post(`/api/v1/acc/supplier-bills/${ids.bill1}/payments`)
        .send({ amountPaisa: 2_462_501, method: 'bank' });
      expect(over.body.code).toBe('AMOUNT_INVALID');
      const rest = await as('principal')
        .post(`/api/v1/acc/supplier-bills/${ids.bill1}/payments`)
        .send({ method: 'bank' });
      expect(rest.body.data.bill).toMatchObject({ paidPaisa: 4_462_500, status: 'paid' });
      const j = await as('accountant').get(`/api/v1/acc/journals/${rest.body.data.payment.journalId}`);
      expect(j.body.data.lines.map((l: { accountCode: string }) => l.accountCode).sort()).toEqual(['1110', '2300']);
      expect(
        (await as('librarian').post(`/api/v1/acc/supplier-bills/${ids.bill2}/payments`).send({ method: 'cash' }))
          .status,
      ).toBe(403);
    } finally {
      clock.set(new Date('2093-03-10T04:00:00Z'));
    }
  });

  it('payables aging, budget vs actual and vendor performance', async () => {
    const vendorAging = async (asOf: string) =>
      (await as('accountant').get(`/api/v1/acc/payables/aging?asOf=${asOf}`)).body.data.vendors.find(
        (v: { vendorId: string }) => v.vendorId === ids.v2,
      );
    // bill 2: dated 25 March, due 24 April (30-day terms)
    expect(await vendorAging('2093-04-01')).toMatchObject({ currentPaisa: 2_975_000, totalPaisa: 2_975_000 });
    expect(await vendorAging('2093-07-15')).toMatchObject({ d61to90Paisa: 2_975_000 });
    expect(await vendorAging('2093-08-01')).toMatchObject({ over90Paisa: 2_975_000 });

    const bva = await as('accountant').get(`/api/v1/acc/budgets/${ids.budget}/vs-actual?asOf=2093-03-31`);
    const books = bva.body.data.rows.find((r: { accountCode: string }) => r.accountCode === '5250');
    expect(books).toMatchObject({
      actualPaisa: 8_500_000,
      committedPaisa: 0,
      availablePaisa: 6_500_000,
      overBudget: false,
    });
    expect(books.variancePaisa).toBe(3_750_000 - 8_500_000);

    const perf = await as('accountant').get(`/api/v1/acc/vendors/${ids.v2}`);
    expect(perf.body.data.performance).toMatchObject({
      orders: 1,
      orderedPaisa: 8_500_000,
      receipts: 2,
      onTimePct: 50,
      avgRating: 3,
      outstandingPaisa: 2_975_000,
    });
  });

  it('beyond the budget: refused without an overrun reason, approved with one', async () => {
    const pr = await as('librarian')
      .post('/api/v1/acc/requisitions')
      .send({
        title: 'Chemistry reference books',
        costCentreId: ids.lib,
        lines: [{ description: 'Chemistry reference', quantity: 80, estUnitPaisa: 100_000, accountId: ids.acc5250 }],
        submit: true,
      });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const refused = await as('principal')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/decide`)
      .send({ decision: 'approved' });
    expect(refused.body.code).toBe('BUDGET_EXCEEDED');
    expect(refused.body.details.overruns[0]).toMatchObject({ accountCode: '5250', overPaisa: 1_500_000 });
    const ok = await as('principal')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/decide`)
      .send({ decision: 'approved', overrunReason: 'Board approved the exam-year library top-up' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ overBudget: true, overrunApprovedBy: ids.user_principal });
    expect(ok.body.data.overruns[0]).toMatchObject({
      accountCode: '5250',
      requestedPaisa: 8_000_000,
      availablePaisa: 6_500_000,
    });
  });
});
