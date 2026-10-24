/**
 * ACC through HTTP: chart of accounts, manual voucher (balance / postable checks), ledger with running balance,
 * reversal (once), fiscal period lock.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const DAY = '2091-10-15';
const clock = new FixedClock(new Date(`${DAY}T06:00:00Z`));

let t: TestApp;
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

beforeAll(async () => {
  t = await createTestApp([], { clock });
  ids.dhn = await t.owner.campusId('DHN');
  tokens.accountant = await login(
    (await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'ACCOUNTANT', campusCode: 'DHN' })).username,
  );
  tokens.principal = await login(
    (await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'PRINCIPAL' })).username,
  );
  // a period left locked by an aborted earlier run
  await as('principal').post('/api/v1/acc/periods/2091-10/status').send({ status: 'open' });
});

afterAll(async () => {
  await t.close();
});

describe('accounts', () => {
  it('chart of accounts is seeded with group and postable accounts', async () => {
    const res = await as('accountant').get('/api/v1/acc/accounts?pageSize=200');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const codes = res.body.data.map((a: { code: string }) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['1000', '1100', '1110', '2100', '2110', '2120', '5100']));
    ids.cash = res.body.data.find((a: { code: string }) => a.code === '1100').id;
  });

  it('manual voucher: balanced, postable accounts only; ledger runs the balance', async () => {
    const line = (accountCode: string, dr: number, cr: number) => ({ accountCode, debitPaisa: dr, creditPaisa: cr });
    const unbalanced = await as('accountant')
      .post('/api/v1/acc/journals')
      .send({
        date: DAY,
        voucherType: 'receipt',
        narration: 'Opening cash',
        lines: [line('1100', 1_000_000, 0), line('3100', 0, 900_000)],
      });
    expect(unbalanced.body.code).toBe('JOURNAL_NOT_BALANCED');
    const group = await as('accountant')
      .post('/api/v1/acc/journals')
      .send({
        date: DAY,
        voucherType: 'receipt',
        narration: 'Opening cash',
        lines: [line('1000', 1_000_000, 0), line('3100', 0, 1_000_000)],
      });
    expect(group.body.code).toBe('ACCOUNT_NOT_POSTABLE');

    const ok = await as('accountant')
      .post('/api/v1/acc/journals')
      .send({
        date: DAY,
        voucherType: 'receipt',
        narration: 'Opening cash',
        lines: [line('1100', 1_000_000, 0), line('3100', 0, 1_000_000)],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({ voucherType: 'receipt', totalPaisa: 1_000_000, campusId: ids.dhn });
    expect(ok.body.data.journalNo).toMatch(/^JV-DHN-/);
    ids.journal = ok.body.data.id;
    const spend = await as('accountant')
      .post('/api/v1/acc/journals')
      .send({
        date: DAY,
        voucherType: 'payment',
        narration: 'Petty cash',
        lines: [line('5130', 250_000, 0), line('1100', 0, 250_000)],
      });
    expect(spend.status, JSON.stringify(spend.body)).toBe(201);

    const ledger = await as('accountant').get(
      `/api/v1/acc/ledger/${ids.cash}?from=${DAY}&to=${DAY}&campusId=${ids.dhn}`,
    );
    expect(ledger.status, JSON.stringify(ledger.body)).toBe(200);
    const mine = ledger.body.data.lines.filter((l: { journalId: string }) =>
      [ids.journal, spend.body.data.id].includes(l.journalId),
    );
    expect(mine).toHaveLength(2);
    expect(mine[1].balancePaisa - mine[0].balancePaisa).toBe(-250_000);
  });

  it('reversal once; a locked period refuses postings', async () => {
    const rev = await as('principal')
      .post(`/api/v1/acc/journals/${ids.journal}/reverse`)
      .send({ reason: 'Entered twice' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.data).toMatchObject({ reversalOfId: ids.journal, totalPaisa: 1_000_000 });
    expect(rev.body.data.lines.find((l: { accountCode: string }) => l.accountCode === '1100')).toMatchObject({
      creditPaisa: 1_000_000,
    });
    const twice = await as('principal').post(`/api/v1/acc/journals/${ids.journal}/reverse`).send({ reason: 'again' });
    expect(twice.body.code).toBe('ALREADY_REVERSED');
    const accountantCannot = await as('accountant').get(`/api/v1/acc/journals/${ids.journal}`);
    expect(accountantCannot.body.data.reversedById).toBe(rev.body.data.id);

    const lock = await as('principal').post('/api/v1/acc/periods/2091-10/status').send({ status: 'locked' });
    expect(lock.status, JSON.stringify(lock.body)).toBe(200);
    const blocked = await as('accountant')
      .post('/api/v1/acc/journals')
      .send({
        date: DAY,
        voucherType: 'journal',
        narration: 'Late entry',
        lines: [
          { accountCode: '1100', debitPaisa: 1, creditPaisa: 0 },
          { accountCode: '3100', debitPaisa: 0, creditPaisa: 1 },
        ],
      });
    expect(blocked.body.code).toBe('PERIOD_LOCKED');
    await as('principal').post('/api/v1/acc/periods/2091-10/status').send({ status: 'open' });
  });
});
