import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { FileStorage, PresignedUpload } from '../../application/ports.js';

export const LOCAL_BLOB_PATH = '/api/v1/files/blob';

export type BlobGrant =
  | { op: 'put'; b: string; k: string; ct: string; len: number; exp: number }
  | { op: 'get'; b: string; k: string; fn?: string; exp: number };

/**
 * Object storage on the local disk for development and tests (no MinIO / S3 needed). Same contract as S3: the client
 * uploads with a signed, short-lived PUT URL and downloads with a signed GET URL; both are served by the API at
 * `LOCAL_BLOB_PATH/:token`. Not for production: one server, no replication.
 */
export class LocalDiskFileStorage implements FileStorage {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly key: Buffer,
  ) {
    this.root = path.resolve(rootDir);
  }

  presignUpload(i: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload> {
    const expiresIn = 300;
    const exp = Date.now() + expiresIn * 1000;
    const token = this.sign({ op: 'put', b: i.bucket, k: i.key, ct: i.contentType, len: i.contentLength, exp });
    return Promise.resolve({
      url: `${LOCAL_BLOB_PATH}/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': i.contentType, 'Content-Length': String(i.contentLength) },
      expiresAt: new Date(exp),
    });
  }

  presignDownload(i: { bucket: string; key: string; fileName?: string; expiresInSec?: number }): Promise<string> {
    const exp = Date.now() + (i.expiresInSec ?? 600) * 1000;
    const grant: BlobGrant = { op: 'get', b: i.bucket, k: i.key, exp, ...(i.fileName ? { fn: i.fileName } : {}) };
    return Promise.resolve(`${LOCAL_BLOB_PATH}/${this.sign(grant)}`);
  }

  async head(i: { bucket: string; key: string }): Promise<{ size: number; contentType?: string | undefined } | null> {
    const file = this.pathOf(i.bucket, i.key);
    try {
      const [s, meta] = await Promise.all([stat(file), readFile(`${file}.meta.json`, 'utf8').catch(() => '{}')]);
      return { size: s.size, contentType: (JSON.parse(meta) as { contentType?: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async put(i: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<void> {
    const file = this.pathOf(i.bucket, i.key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, i.body);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: i.contentType }));
  }

  /** Stores an upload stream; refuses more bytes than were signed (the temp file is removed). */
  async putStream(
    i: { bucket: string; key: string; contentType: string; maxBytes: number },
    body: NodeJS.ReadableStream,
  ) {
    const file = this.pathOf(i.bucket, i.key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        cb(size > i.maxBytes ? new Error('BLOB_TOO_LARGE') : null, chunk);
      },
    });
    try {
      await pipeline(body, limit, createWriteStream(tmp));
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    await rename(tmp, file);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: i.contentType }));
    return { size };
  }

  getStream(i: { bucket: string; key: string }): Promise<NodeJS.ReadableStream> {
    return Promise.resolve(createReadStream(this.pathOf(i.bucket, i.key)));
  }

  async delete(i: { bucket: string; key: string }): Promise<void> {
    const file = this.pathOf(i.bucket, i.key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  /** The grant of a valid, unexpired token; null otherwise. */
  verify(token: string): BlobGrant | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = this.mac(body);
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BlobGrant;
      return grant.exp > Date.now() ? grant : null;
    } catch {
      return null;
    }
  }

  private sign(grant: BlobGrant): string {
    const body = Buffer.from(JSON.stringify(grant)).toString('base64url');
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.key).update(body).digest();
  }

  /** bucket/key inside the root; anything that could escape it is refused. */
  private pathOf(bucket: string, key: string): string {
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error('Invalid bucket name');
    const parts = key.split('/');
    if (!key || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0')))
      throw new Error('Invalid object key');
    const file = path.resolve(this.root, bucket, ...parts);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Invalid object key');
    return file;
  }
}
