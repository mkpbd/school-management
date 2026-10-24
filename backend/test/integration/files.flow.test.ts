/**
 * Local-disk file storage (dev / test without MinIO): presigned PUT and GET through the API, signed tokens, size and
 * type checks; a notice carries the uploaded attachment and a recipient downloads it.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
let t: TestApp;
let run: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const PDF = Buffer.from('%PDF-1.4\n% test attachment\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const as = (who: string) => ({
  get: (url: string) => request(t.app).get(url).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url: string) =>
    request(t.app).post(url).set('Authorization', `Bearer ${tokens[who]}`).set('Idempotency-Key', key()),
});

async function login(username: string): Promise<string> {
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: PASSWORD, client: 'staff_app' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

beforeAll(async () => {
  t = await createTestApp([]);
  run = t.owner.runId;
  ids.dhn = await t.owner.campusId('DHN');
  const coord = await t.owner.createStaffUser({
    password: PASSWORD,
    roleCode: 'ACADEMIC_COORDINATOR',
    campusCode: 'DHN',
  });
  tokens.coord = await login(coord.username);
  const reader = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'CLASS_TEACHER', campusCode: 'DHN' });
  ids.reader = reader.id;
  tokens.reader = await login(reader.username);
});

afterAll(async () => {
  await t.close();
});

describe('local file storage', () => {
  it('upload with the presigned PUT, complete, attach to a notice, recipient downloads it', async () => {
    const up = await as('coord')
      .post('/api/v1/files/uploads')
      .send({
        purpose: 'notice_attachment',
        fileName: `trip-${run}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
      });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const { fileId, upload } = up.body.data as {
      fileId: string;
      upload: { url: string; headers: Record<string, string> };
    };
    expect(upload.url).toMatch(/^\/api\/v1\/files\/blob\//);

    const wrongType = await request(t.app).put(upload.url).set('Content-Type', 'image/png').send(PDF);
    expect(wrongType.status).toBe(400);
    const tooBig = await request(t.app)
      .put(upload.url)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.concat([PDF, Buffer.from('extra')]));
    expect([400, 413]).toContain(tooBig.status);
    const tampered = await request(t.app)
      .put(`${upload.url.slice(0, -2)}xx`)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(tampered.status).toBe(403);
    const put = await request(t.app).put(upload.url).set('Content-Type', 'application/pdf').send(PDF);
    expect(put.status).toBe(200);

    const done = await as('coord').post(`/api/v1/files/${fileId}/complete`).send();
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const notice = await as('coord')
      .post('/api/v1/com/notices')
      .send({
        campusId: ids.dhn,
        titleEn: `Field trip ${run}`,
        bodyEn: 'Consent form attached; please sign and return by Thursday.',
        audiences: [{ type: 'user', id: ids.reader }],
        attachmentFileIds: [fileId],
        publishNow: true,
      });
    expect(notice.status, JSON.stringify(notice.body)).toBe(201);
    // the generic file link is for the uploader only; readers go through the notice
    expect((await as('reader').get(`/api/v1/files/${fileId}/url`)).status).toBe(404);
    const outsider = await t.owner.createStaffUser({
      password: PASSWORD,
      roleCode: 'CLASS_TEACHER',
      campusCode: 'DHN',
    });
    tokens.outsider = await login(outsider.username);
    const path = `/api/v1/com/notices/${notice.body.data.id}/attachments/${fileId}/url`;
    expect((await as('outsider').get(path)).status).toBe(404);

    const link = await as('reader').get(path);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const file = await request(t.app)
      .get(link.body.data.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain(`trip-${run}.pdf`);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

    // an upload token cannot be used to read, nor a download token to write
    expect((await request(t.app).get(upload.url)).status).toBe(403);
    expect((await request(t.app).put(link.body.data.url).set('Content-Type', 'application/pdf').send(PDF)).status).toBe(
      403,
    );
  });
});
