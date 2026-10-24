/**
 * End-to-end through HTTP: contracts -> bank account -> loan -> monthly run with festival bonus -> inputs ->
 * compute -> maker-checker approval -> lock (loans recovered, payslips frozen, staff SMS) -> bank advice -> paid
 * -> self-service payslips. Each run uses its own campus (payroll is unique per campus and month).
 */
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const MONTH = '2091-11'; // 30 days
const clock = new FixedClock(new Date('2091-11-28T06:00:00Z'));

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

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  const orgId = await t.owner.orgId();
  const [campus] = await t.owner.query<{ id: string }>(
    `INSERT INTO core.campus (org_id, code, name_en) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, `P${run}`, `Payroll campus ${run}`],
  );
  ids.campus = campus!.id;
  for (const [who, roleCode] of [
    ['hr', 'HR'],
    ['principal', 'PRINCIPAL'],
    ['it', 'IT_ADMIN'],
  ] as const) {
    const u = await t.owner.createStaffUser({ password: PASSWORD, roleCode });
    tokens[who] = await login(u.username);
  }
  const mkStaff = async (no: string, name: string, joinedOn: string, phone: string) => {
    const res = await as('hr')
      .post('/api/v1/hrm/staff')
      .send({
        campusId: ids.campus,
        staffNo: `${no}-${run}`,
        fullNameEn: name,
        gender: 'female',
        phone,
        staffType: 'teaching',
        joinedOn,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };
  ids.phone1 = `+88017${String(Date.now()).slice(-8)}`;
  ids.t1 = await mkStaff('T1', 'Farhana Teacher', '2090-01-01', ids.phone1);
  ids.t2 = await mkStaff('T2', 'Nadia Newcomer', '2091-11-16', `+88019${String(Date.now() + 3).slice(-8)}`);
  const account = await as('it')
    .post(`/api/v1/hrm/staff/${ids.t1}/account`)
    .send({ username: `pay.t1.${run}`, password: PASSWORD, roleCode: 'CLASS_TEACHER', campusId: ids.campus });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  tokens.t1 = await login(`pay.t1.${run}`);
});

afterAll(async () => {
  await t.close();
});

describe('payroll set-up', () => {
  it('contracts with components; contracts never overlap', async () => {
    const c1 = await as('hr')
      .post(`/api/v1/hrm/staff/${ids.t1}/contracts`)
      .send({
        contractType: 'permanent',
        startsOn: '2090-01-01',
        basicPaisa: 3_000_000,
        components: [
          { componentCode: 'HOUSE', percent: 50 },
          { componentCode: 'MEDICAL', amountPaisa: 200_000 },
          { componentCode: 'OT', amountPaisa: 20_000 },
          { componentCode: 'FEST_BONUS', percent: 100 },
          { componentCode: 'PF', percent: 10 },
          { componentCode: 'TAX', amountPaisa: 100_000 },
          { componentCode: 'PF_EMPLOYER', percent: 10 },
        ],
      });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.data.components).toHaveLength(7);
    const overlap = await as('hr')
      .post(`/api/v1/hrm/staff/${ids.t1}/contracts`)
      .send({ contractType: 'permanent', startsOn: '2091-01-01', basicPaisa: 1, components: [] });
    expect(overlap.body.code).toBe('OVERLAP');
    const wrongValue = await as('hr')
      .post(`/api/v1/hrm/staff/${ids.t2}/contracts`)
      .send({
        contractType: 'probation',
        startsOn: '2091-11-16',
        basicPaisa: 1,
        components: [{ componentCode: 'HOUSE', amountPaisa: 5 }],
      });
    expect(wrongValue.body.code).toBe('COMPONENT_VALUE');
    const c2 = await as('hr')
      .post(`/api/v1/hrm/staff/${ids.t2}/contracts`)
      .send({
        contractType: 'probation',
        startsOn: '2091-11-16',
        basicPaisa: 2_000_000,
        components: [{ componentCode: 'HOUSE', percent: 50 }],
      });
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
  });

  it('bank account is stored encrypted; a loan is granted', async () => {
    const bank = await as('hr')
      .put(`/api/v1/hrm/staff/${ids.t1}/bank-account`)
      .send({
        account: {
          bankName: 'Dutch-Bangla Bank',
          branchName: 'Gulshan',
          routingNo: '090261726',
          accountName: 'Farhana Teacher',
          accountNo: '1051100012345',
        },
      });
    expect(bank.status, JSON.stringify(bank.body)).toBe(200);
    expect(bank.body.data.accountNoLast4).toBe('2345');
    const [row] = await t.owner.query<{ enc: Buffer }>(`SELECT bank_account_enc AS enc FROM hrm.staff WHERE id = $1`, [
      ids.t1,
    ]);
    expect(row!.enc.toString('utf8')).not.toContain('1051100012345');

    const loan = await as('hr').post(`/api/v1/hrm/staff/${ids.t1}/loans`).send({
      kind: 'loan',
      principalPaisa: 1_000_000,
      installmentPaisa: 250_000,
      startsMonth: MONTH,
      reason: 'Medical',
    });
    expect(loan.status, JSON.stringify(loan.body)).toBe(201);
    expect(loan.body.data.installments).toBe(4);
    ids.loan = loan.body.data.id;
  });
});

describe('monthly run (HRM-04)', () => {
  it('create with festival bonus, enter inputs, compute', async () => {
    const bad = await as('hr')
      .post('/api/v1/hrm/payroll-runs')
      .send({ campusId: ids.campus, month: MONTH, includeComponents: ['MEDICAL'] });
    expect(bad.body.code).toBe('NOT_OCCASIONAL');
    const res = await as('hr')
      .post('/api/v1/hrm/payroll-runs')
      .send({ campusId: ids.campus, month: MONTH, includeComponents: ['FEST_BONUS'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft', periodMonth: `${MONTH}-01` });
    ids.run = res.body.data.id;
    const dup = await as('hr').post('/api/v1/hrm/payroll-runs').send({ campusId: ids.campus, month: MONTH });
    expect(dup.body.code).toBe('DUPLICATE');

    const inputs = await as('hr')
      .put(`/api/v1/hrm/payroll-runs/${ids.run}/inputs`)
      .send({ rows: [{ staffId: ids.t1, lwpDays: 1, overtimeMinutes: 120 }] });
    expect(inputs.status, JSON.stringify(inputs.body)).toBe(200);

    // income-tax table of the 2091-92 income year: T1's contract has a fixed TAX (kept); T2 earns below the threshold
    const TK = 100;
    const table = await as('hr')
      .put('/api/v1/hrm/tax-years/2091-92')
      .send({
        startsOn: '2091-07-01',
        endsOn: '2092-06-30',
        sourceNote: 'test table',
        rules: {
          thresholds: { general: 400_000 * TK, female: 450_000 * TK },
          slabs: [
            { widthPaisa: 300_000 * TK, ratePct: 10 },
            { widthPaisa: null, ratePct: 15 },
          ],
          salaryExemption: { fraction: 1 / 3, capPaisa: 450_000 * TK },
          rebate: { incomePct: 3, investmentPct: 15, capPaisa: 1_000_000 * TK },
          minimumTaxPaisa: 5_000 * TK,
        },
      });
    expect(table.status, JSON.stringify(table.body)).toBe(200);
    expect(table.body.data.verifiedAt).toBeNull();
    const badTable = await as('hr')
      .put('/api/v1/hrm/tax-years/2091-92')
      .send({
        ...table.body.data,
        code: undefined,
        verifiedBy: undefined,
        verifiedAt: undefined,
        rules: { ...table.body.data.rules, slabs: [{ widthPaisa: 1, ratePct: 10 }] },
      });
    expect(badTable.status).toBe(422);
    const profile = await as('hr')
      .put(`/api/v1/hrm/staff/${ids.t2}/tax-profile`)
      .send({ taxYearCode: '2091-92', category: 'female', declaredInvestmentPaisa: 0 });
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);

    const firstCompute = await as('hr').post(`/api/v1/hrm/payroll-runs/${ids.run}/compute`).send();
    expect(firstCompute.body.data.warnings.map((w: { code: string }) => w.code)).toContain('TAX_TABLE_UNVERIFIED');
    const verified = await as('principal').post('/api/v1/hrm/tax-years/2091-92/verify').send();
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.data.verifiedAt).not.toBeNull();

    const computed = await as('hr').post(`/api/v1/hrm/payroll-runs/${ids.run}/compute`).send();
    expect(computed.status, JSON.stringify(computed.body)).toBe(200);
    expect(computed.body.data.warnings.map((w: { code: string }) => w.code)).not.toContain('TAX_TABLE_UNVERIFIED');
    // T1: 30,000 + 15,000 + 2,000 + OT 400 + bonus 30,000 = 77,400 gross;
    //     PF 3,000 + TAX 1,000 + LWP 47,000/30 (1,566.67) + loan 2,500 = 8,066.67 deductions
    // T2: joins on the 16th -> 15/30 of (20,000 + 10,000) = 15,000
    expect(computed.body.data).toMatchObject({
      staff: 2,
      grossPaisa: 7_740_000 + 1_500_000,
      deductionsPaisa: 806_667,
      netPaisa: 6_933_333 + 1_500_000,
      skipped: [],
    });

    const sheet = await as('hr').get(`/api/v1/hrm/payroll-runs/${ids.run}`);
    expect(sheet.body.data.status).toBe('computed');
    const t2 = sheet.body.data.payslips.find((p: { staffId: string }) => p.staffId === ids.t2);
    expect(t2).toMatchObject({ workingDays: 30, paidDays: 15, netPaisa: 1_500_000 });
    ids.slip1 = sheet.body.data.payslips.find((p: { staffId: string }) => p.staffId === ids.t1).id;
    ids.slip2 = t2.id;
  });

  it('maker-checker: the submitter cannot approve; the principal can', async () => {
    const submit = await as('hr').post(`/api/v1/hrm/payroll-runs/${ids.run}/submit`).send();
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);
    const late = await as('hr')
      .put(`/api/v1/hrm/payroll-runs/${ids.run}/inputs`)
      .send({ rows: [{ staffId: ids.t2, lwpDays: 1 }] });
    expect(late.body.code).toBe('PAYROLL_STATUS');
    const self = await as('hr').post(`/api/v1/hrm/payroll-runs/${ids.run}/decision`).send({ decision: 'approve' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('MAKER_CHECKER');
    const early = await as('principal').get(`/api/v1/hrm/payroll-runs/${ids.run}/bank-advice`);
    expect(early.body.code).toBe('PAYROLL_STATUS');

    const ok = await as('principal')
      .post(`/api/v1/hrm/payroll-runs/${ids.run}/decision`)
      .send({ decision: 'approve', note: 'Checked against attendance' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('approved');
  });

  it('lock: loan installment recovered, payslips frozen, staff told by SMS', async () => {
    const lock = await as('principal').post(`/api/v1/hrm/payroll-runs/${ids.run}/lock`).send();
    expect(lock.status, JSON.stringify(lock.body)).toBe(200);
    expect(lock.body.data).toMatchObject({ status: 'locked', loansUpdated: 1 });
    const loans = await as('hr').get(`/api/v1/hrm/loans?staffId=${ids.t1}`);
    expect(loans.body.data[0]).toMatchObject({ outstandingPaisa: 750_000, status: 'active' });

    await expect(
      t.owner.query(`UPDATE hrm.payslip SET net_paisa = net_paisa + 1 WHERE id = $1`, [ids.slip1]),
    ).rejects.toThrow(/frozen/);
    const again = await as('hr').post(`/api/v1/hrm/payroll-runs/${ids.run}/compute`).send();
    expect(again.body.code).toBe('PAYROLL_STATUS');

    await drainOutbox();
    const [sms] = await t.owner.query<{ body: string }>(
      `SELECT body FROM com.outbound_message WHERE dedupe_key = $1 AND recipient_address = $2 AND channel = 'sms'`,
      [`hrm.payslip_ready:${ids.run}`, ids.phone1],
    );
    expect(sms!.body).toContain('November 2091');
    expect(sms!.body).not.toMatch(/\d{2},\d{3}/); // no amounts by SMS
  });

  it('bank advice CSV, then marked paid', async () => {
    const csv = await as('principal').get(`/api/v1/hrm/payroll-runs/${ids.run}/bank-advice`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['x-missing-accounts']).toBe('1');
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe('staff_no,name,bank,branch,routing_no,account_name,account_no,amount_bdt');
    expect(lines).toContain(
      `T1-${run},Farhana Teacher,Dutch-Bangla Bank,Gulshan,090261726,Farhana Teacher,1051100012345,69333.33`,
    );
    expect(lines).toContain(`T2-${run},Nadia Newcomer,CASH,,,,,15000.00`);

    const paid = await as('principal')
      .post(`/api/v1/hrm/payroll-runs/${ids.run}/paid`)
      .send({ paymentReference: `BEFTN-${run}` });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'paid', paymentReference: `BEFTN-${run}` });
  });

  it('accounts: salary journal on lock, payment journal when paid, trial balance balanced', async () => {
    await drainOutbox();
    const journals = await as('principal').get(`/api/v1/acc/journals?campusId=${ids.campus}&sourceModule=hrm`);
    expect(journals.status, JSON.stringify(journals.body)).toBe(200);
    const salary = journals.body.data.find((j: { sourceType: string }) => j.sourceType === 'payroll_run');
    const payment = journals.body.data.find((j: { sourceType: string }) => j.sourceType === 'payroll_payment');
    expect(salary).toMatchObject({ sourceId: ids.run, journalDate: '2091-11-30', totalPaisa: 9_383_333 });
    expect(payment).toMatchObject({ voucherType: 'payment', totalPaisa: 8_433_333 });
    const detail = await as('principal').get(`/api/v1/acc/journals/${salary.id}`);
    const by = Object.fromEntries(
      detail.body.data.lines.map((l: { accountCode: string; debitPaisa: number; creditPaisa: number }) => [
        l.accountCode,
        l.debitPaisa || -l.creditPaisa,
      ]),
    );
    expect(by).toMatchObject({
      '5100': 6_043_333,
      '5120': 3_000_000,
      '2100': -8_433_333,
      '2110': -600_000,
      '1210': -250_000,
    });

    const tb = await as('principal').get(`/api/v1/acc/trial-balance?asOf=2091-11-30&campusId=${ids.campus}`);
    expect(tb.status, JSON.stringify(tb.body)).toBe(200);
    expect(tb.body.data.totals.balanced).toBe(true);
    // salaries payable cleared by the transfer
    expect(tb.body.data.rows.find((r: { code: string }) => r.code === '2100')?.balancePaisa ?? 0).toBe(0);
  });

  it('payslip PDFs: own payslip for the staff member, the whole run for HR', async () => {
    const binary = (r: request.Request) =>
      r.buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const own = await binary(as('t1').get(`/api/v1/hrm/payslips/${ids.slip1}/pdf`));
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    const pdf = own.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
    if (process.env.PAYSLIP_PDF_OUT) writeFileSync(process.env.PAYSLIP_PDF_OUT, pdf);
    const other = await as('t1').get(`/api/v1/hrm/payslips/${ids.slip2}/pdf`);
    expect(other.status).toBe(404);
    const all = await binary(as('hr').get(`/api/v1/hrm/payroll-runs/${ids.run}/payslips-pdf`));
    expect(all.status).toBe(200);
    expect((all.body as Buffer).toString('latin1')).toMatch(/\/Count 2/); // two pages
  });

  it('staff see only their own payslip', async () => {
    const mine = await as('t1').get('/api/v1/hrm/me/payslips');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ periodMonth: `${MONTH}-01`, netPaisa: 6_933_333 });
    const slip = await as('t1').get(`/api/v1/hrm/payslips/${ids.slip1}`);
    expect(slip.status, JSON.stringify(slip.body)).toBe(200);
    expect(slip.body.data.lines.map((l: { code: string }) => l.code)).toEqual(
      expect.arrayContaining([
        'BASIC',
        'HOUSE',
        'MEDICAL',
        'OT',
        'FEST_BONUS',
        'PF',
        'TAX',
        'LWP',
        'LOAN',
        'PF_EMPLOYER',
      ]),
    );
    const other = await as('t1').get(`/api/v1/hrm/payslips/${ids.slip2}`);
    expect(other.status).toBe(404);
    const sheet = await as('t1').get(`/api/v1/hrm/payroll-runs/${ids.run}`);
    expect(sheet.status).toBe(403);
  });
});
