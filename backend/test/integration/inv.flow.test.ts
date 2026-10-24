/**
 * Inventory (INV-01 / INV-02): items with variants, stores, opening stock, issue notes (no negative stock), transfer
 * at average cost, stock count, reorder levels, ledger with running balance, campus isolation; a purchase order for
 * a stock item is received into a store (goods receipt -> stock, average cost) and printed as PDF.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const clock = new FixedClock(new Date('2094-05-10T04:00:00Z'));
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
});

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

const stockOf = async (storeId: string | undefined, variantId: string | undefined) =>
  ((await as('keeper').get(`/api/v1/inv/stores/${storeId}/stock`)).body.data.rows as Array<{ variantId: string }>).find(
    (r) => r.variantId === variantId,
  ) as { onHand: number; avgCostPaisa: number; valuePaisa: number; low: boolean } | undefined;

beforeAll(async () => {
  t = await createTestApp([], { clock });
  run = t.owner.runId;
  ids.dhn = await t.owner.campusId('DHN');
  for (const [who, role, campus] of [
    ['keeper', 'STORE_KEEPER', 'DHN'],
    ['gulKeeper', 'STORE_KEEPER', 'GUL'],
    ['accountant', 'ACCOUNTANT', 'DHN'],
    ['principal', 'PRINCIPAL', undefined],
  ] as const) {
    const u = await t.owner.createStaffUser({
      password: PASSWORD,
      roleCode: role,
      ...(campus ? { campusCode: campus } : {}),
    });
    tokens[who] = await login(u.username);
  }
  const orgId = await t.owner.orgId();
  const [a] = await t.owner.query<{ id: string }>(`SELECT id FROM acc.account WHERE org_id = $1 AND code = '5200'`, [
    orgId,
  ]);
  ids.acc5200 = a!.id;
  const [cc] = await t.owner.query<{ id: string }>(
    `SELECT id FROM acc.cost_centre WHERE org_id = $1 AND code = 'ACAD'`,
    [orgId],
  );
  ids.acad = cc!.id;
});

afterAll(async () => {
  await t.close();
});

describe('items and stores', () => {
  it('items get variants (STD by default); stores per campus', async () => {
    const book = await as('keeper')
      .post('/api/v1/inv/items')
      .send({ sku: `EXB${run}`, nameEn: 'Exercise book 120 pages', category: 'stationery', unit: 'pcs' });
    expect(book.status, JSON.stringify(book.body)).toBe(201);
    expect(book.body.data.variants.map((v: { code: string }) => v.code)).toEqual(['STD']);
    ids.book = book.body.data.variants[0].id;
    const shirt = await as('keeper')
      .post('/api/v1/inv/items')
      .send({
        sku: `SHIRT${run}`,
        nameEn: 'School shirt',
        category: 'uniform',
        unit: 'pcs',
        isSellable: true,
        variants: [
          { code: 'S-28', attributes: { size: '28' }, salePricePaisa: 65_000 },
          { code: 'M-32', attributes: { size: '32' }, salePricePaisa: 70_000 },
        ],
      });
    expect(shirt.status, JSON.stringify(shirt.body)).toBe(201);
    ids.shirtS = shirt.body.data.variants.find((v: { code: string }) => v.code === 'S-28').id;
    expect(
      (
        await as('keeper')
          .post('/api/v1/inv/items')
          .send({ sku: `EXB${run}`, nameEn: 'x', category: 'other', unit: 'pcs' })
      ).status,
    ).toBe(409);

    const store = async (who: string, code: string, kind: string) => {
      const res = await as(who)
        .post('/api/v1/inv/stores')
        .send({ code: `${code}${run}`.slice(0, 30), name: `${code} store`, kind });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.central = await store('keeper', 'CEN', 'central');
    ids.uniform = await store('keeper', 'UNI', 'uniform_shop');
    ids.gul = await store('gulKeeper', 'GCEN', 'central');
    expect((await as('keeper').get(`/api/v1/inv/stores/${ids.gul}/stock`)).status).toBe(404);
  });
});

describe('stock ledger', () => {
  it('opening, issue (never negative), transfer at cost, count, reorder level, ledger', async () => {
    const opening = await as('keeper')
      .post(`/api/v1/inv/stores/${ids.central}/receipts`)
      .send({
        kind: 'opening',
        lines: [
          { variantId: ids.book, qty: 500, unitCostPaisa: 2_500 },
          { variantId: ids.shirtS, qty: 20, unitCostPaisa: 45_000 },
        ],
      });
    expect(opening.status, JSON.stringify(opening.body)).toBe(201);

    const issue = await as('keeper')
      .post(`/api/v1/inv/stores/${ids.central}/issues`)
      .send({ issuedTo: 'Year 7 - A (class teacher)', lines: [{ variantId: ids.book, qty: 120 }] });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const tooMany = await as('keeper')
      .post(`/api/v1/inv/stores/${ids.central}/issues`)
      .send({ issuedTo: 'Year 8', lines: [{ variantId: ids.book, qty: 1000 }] });
    expect(tooMany.body.code).toBe('INSUFFICIENT_STOCK');

    const move = await as('keeper')
      .post('/api/v1/inv/transfers')
      .send({ fromStoreId: ids.central, toStoreId: ids.uniform, lines: [{ variantId: ids.shirtS, qty: 10 }] });
    expect(move.status, JSON.stringify(move.body)).toBe(201);
    expect(await stockOf(ids.uniform, ids.shirtS)).toMatchObject({ onHand: 10, avgCostPaisa: 45_000 });
    expect(await stockOf(ids.central, ids.shirtS)).toMatchObject({ onHand: 10 });
    const cross = await as('keeper')
      .post('/api/v1/inv/transfers')
      .send({ fromStoreId: ids.central, toStoreId: ids.gul, lines: [{ variantId: ids.shirtS, qty: 1 }] });
    expect(cross.status).toBe(404);

    const count = await as('keeper')
      .post(`/api/v1/inv/stores/${ids.central}/counts`)
      .send({
        reason: 'Term-end count',
        lines: [
          { variantId: ids.book, countedQty: 375 },
          { variantId: ids.shirtS, countedQty: 10 },
        ],
      });
    expect(count.status, JSON.stringify(count.body)).toBe(201);
    expect(count.body.data.differences).toEqual([{ variantId: ids.book, delta: -5 }]);

    expect(
      (
        await as('keeper')
          .put(`/api/v1/inv/stores/${ids.central}/levels/${ids.book}`)
          .send({ minQty: 400, maxQty: 1000 })
      ).status,
    ).toBe(200);
    const low = await as('keeper').get(`/api/v1/inv/stores/${ids.central}/stock?lowOnly=true`);
    expect(low.body.data.rows.map((r: { variantId: string }) => r.variantId)).toEqual([ids.book]);
    expect(low.body.data.lowCount).toBe(1);

    const ledger = await as('keeper').get(`/api/v1/inv/stores/${ids.central}/movements?variantId=${ids.book}`);
    expect(
      ledger.body.data.map((m: { movementType: string; qtyDelta: number; balanceQty: number }) => [
        m.movementType,
        m.qtyDelta,
        m.balanceQty,
      ]),
    ).toEqual([
      ['adjustment', -5, 375],
      ['issue', -120, 380],
      ['opening', 500, 500],
    ]);
    expect(ledger.body.data[1].issuedTo).toBe('Year 7 - A (class teacher)');
  });
});

describe('purchase -> goods receipt -> stock', () => {
  it('a PO line for a stock item is received into the store at the purchase price', async () => {
    const vendor = await as('accountant')
      .post('/api/v1/acc/vendors')
      .send({ code: `STN${run}`, name: `Stationers ${run}` });
    expect(vendor.status, JSON.stringify(vendor.body)).toBe(201);
    const pr = await as('accountant')
      .post('/api/v1/acc/requisitions')
      .send({
        title: 'Exercise books for June',
        costCentreId: ids.acad,
        lines: [
          {
            description: 'Exercise book 120 pages',
            quantity: 200,
            estUnitPaisa: 2_400,
            accountId: ids.acc5200,
            itemVariantId: ids.book,
          },
        ],
        submit: true,
      });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const ok = await as('principal')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/decide`)
      .send({ decision: 'approved', overrunReason: 'No budget loaded for this test year' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const q = await as('accountant')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/quotations`)
      .send({ vendorId: vendor.body.data.id, totalPaisa: 480_000 });
    await as('principal')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/quotations/${q.body.data.id}/select`)
      .send({});
    const po = await as('accountant')
      .post(`/api/v1/acc/requisitions/${pr.body.data.id}/purchase-order`)
      .send({
        expectedOn: '2094-05-20',
        lines: [
          {
            description: 'Exercise book 120 pages',
            quantity: 200,
            unitPaisa: 2_400,
            accountId: ids.acc5200,
            itemVariantId: ids.book,
          },
        ],
      });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    const line = po.body.data.lines[0].id;

    const noStore = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${po.body.data.id}/receipts`)
      .send({ lines: [{ poLineId: line, quantity: 200 }] });
    expect(noStore.body.code).toBe('STORE_REQUIRED');
    const otherCampus = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${po.body.data.id}/receipts`)
      .send({ storeId: ids.gul, lines: [{ poLineId: line, quantity: 200 }] });
    expect(otherCampus.body.code).toBe('STORE_INVALID');
    const grn = await as('accountant')
      .post(`/api/v1/acc/purchase-orders/${po.body.data.id}/receipts`)
      .send({ storeId: ids.central, lines: [{ poLineId: line, quantity: 200 }] });
    expect(grn.status, JSON.stringify(grn.body)).toBe(201);
    expect(grn.body.data.storeId).toBe(ids.central);

    // 375 @ 25.00 + 200 @ 24.00 -> 575 @ 24.65 (weighted average, whole paisa)
    expect(await stockOf(ids.central, ids.book)).toMatchObject({ onHand: 575, avgCostPaisa: 2_465, low: false });
    const ledger = await as('keeper').get(`/api/v1/inv/stores/${ids.central}/movements?variantId=${ids.book}`);
    expect(ledger.body.data[0]).toMatchObject({
      movementType: 'receipt',
      qtyDelta: 200,
      balanceQty: 575,
      refType: 'goods_receipt',
    });

    const pdf = await as('accountant')
      .get(`/api/v1/acc/purchase-orders/${po.body.data.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
