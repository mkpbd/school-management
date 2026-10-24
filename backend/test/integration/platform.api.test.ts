import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const PASSWORD = 'Correct-Horse-Battery-9';
let t: TestApp;
let token: string;

beforeAll(async () => {
  t = await createTestApp();
  const user = await t.owner.createStaffUser({ password: PASSWORD, roleCode: 'ADMISSION_OFFICER', campusCode: 'DHN' });
  const res = await request(t.app)
    .post('/api/v1/auth/login')
    .send({ identifier: user.username, password: PASSWORD, client: 'staff_app' });
  token = res.body.data.accessToken;
});

afterAll(async () => {
  await t.close();
});

const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

describe('system endpoints', () => {
  it('health live/ready', async () => {
    expect((await request(t.app).get('/health/live')).body.data.status).toBe('ok');
    const ready = await request(t.app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.checks.database).toBe('ok');
    expect(ready.body.data.checks.schema).toMatch(/^\d{4}_/);
  });

  it('unknown route: 404 problem+json with request id and security headers', async () => {
    const res = await request(t.app).get('/api/v1/nope').set('X-Request-Id', 'test-request-0001');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', requestId: 'test-request-0001' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('malformed JSON is a 400, not a 500', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MALFORMED_JSON');
  });

  it('OpenAPI document is generated from the route definitions', async () => {
    const res = await request(t.app).get('/api/v1/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/auth/login', '/api/v1/files/{id}/url', '/api/v1/me']),
    );
    expect(res.body.paths['/api/v1/files/uploads'].post.description).toContain('Idempotency-Key');
  });

  it('Swagger UI is served self-hosted with a strict CSP and test helpers', async () => {
    const page = await request(t.app).get('/api/docs');
    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui-bundle.js');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).not.toContain('unsafe-eval');
    const bundle = await request(t.app).get('/api/docs/assets/swagger-ui-bundle.js');
    expect(bundle.status).toBe(200);
    const init = await request(t.app).get('/api/docs/init.js');
    expect(init.text).toContain('/api/v1/docs.json');
    expect(init.text).toContain('X-CSRF-Token');

    const spec = (await request(t.app).get('/api/v1/docs.json')).body;
    const params = spec.paths['/api/v1/files/uploads'].post.parameters as Array<{ name: string; in: string }>;
    expect(params.map((p) => `${p.in}:${p.name}`)).toEqual(
      expect.arrayContaining(['header:Idempotency-Key', 'header:X-Campus-Id']),
    );
    expect(spec.servers[0].url).toBe('/');
  });

  it('metrics require the token', async () => {
    expect((await request(t.app).get('/metrics')).status).toBe(404);
    const res = await request(t.app).get('/metrics').set('Authorization', 'Bearer test-metrics-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
  });
});

describe('files: policies, idempotency, download guard', () => {
  const body = {
    purpose: 'student_document',
    fileName: 'birth-certificate.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
  };

  it('validates purpose, type and size', async () => {
    const unknown = await auth(request(t.app).post('/api/v1/files/uploads'))
      .set('Idempotency-Key', 'files-unknown-01')
      .send({ ...body, purpose: 'x' });
    expect(unknown.body.code).toBe('FILE_PURPOSE_UNKNOWN');
    const type = await auth(request(t.app).post('/api/v1/files/uploads'))
      .set('Idempotency-Key', 'files-type-0001')
      .send({ ...body, mimeType: 'application/x-msdownload' });
    expect(type.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const big = await auth(request(t.app).post('/api/v1/files/uploads'))
      .set('Idempotency-Key', 'files-big-00001')
      .send({ ...body, sizeBytes: 50 * 1024 * 1024 });
    expect(big.body.code).toBe('FILE_TOO_LARGE');
    const missingKey = await auth(request(t.app).post('/api/v1/files/uploads')).send(body);
    expect(missingKey.status).toBe(422);
  });

  it('creates a presigned upload; same Idempotency-Key replays, different body is refused', async () => {
    const key = `files-ok-${t.owner.runId}`;
    const first = await auth(request(t.app).post('/api/v1/files/uploads')).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    // signed URL: S3 / MinIO presign, or the local-disk driver used in tests (token = payload.hmac)
    expect(first.body.data.upload.url).toMatch(/X-Amz-Signature=|^\/api\/v1\/files\/blob\/[\w-]+\.[\w-]+$/);
    expect(first.body.data.upload.method).toBe('PUT');

    const replay = await auth(request(t.app).post('/api/v1/files/uploads')).set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.fileId).toBe(first.body.data.fileId);

    const reused = await auth(request(t.app).post('/api/v1/files/uploads'))
      .set('Idempotency-Key', key)
      .send({ ...body, sizeBytes: 4096 });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const [row] = await t.owner.query<{ n: number; scan_status: string; object_key: string }>(
      `SELECT count(*) OVER ()::int AS n, scan_status, object_key FROM sys.stored_file WHERE id = $1`,
      [first.body.data.fileId],
    );
    expect(row).toMatchObject({ n: 1, scan_status: 'pending' });
    expect(row!.object_key).not.toContain('birth'); // no PII in object keys

    const url = await auth(request(t.app).get(`/api/v1/files/${first.body.data.fileId}/url`));
    expect(url.status).toBe(409);
    expect(url.body.code).toBe('FILE_NOT_AVAILABLE');
  });
});
