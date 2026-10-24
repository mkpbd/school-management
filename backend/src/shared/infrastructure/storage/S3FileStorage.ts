import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { FileStorage, PresignedUpload } from '../../application/ports.js';

/**
 * S3 / MinIO object storage (docs/backend/cross-cutting.md §13). Documents are never served from the web root:
 * clients upload with a presigned PUT and download with a short-lived presigned GET.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(o: {
    endpoint?: string | undefined;
    region: string;
    accessKeyId?: string | undefined;
    secretAccessKey?: string | undefined;
    forcePathStyle: boolean;
  }) {
    this.client = new S3Client({
      region: o.region,
      endpoint: o.endpoint,
      forcePathStyle: o.forcePathStyle,
      credentials:
        o.accessKeyId && o.secretAccessKey
          ? { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey }
          : undefined,
    });
  }

  async presignUpload(i: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload> {
    const expiresIn = 300;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: i.bucket,
        Key: i.key,
        ContentType: i.contentType,
        ContentLength: i.contentLength,
      }),
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': i.contentType, 'Content-Length': String(i.contentLength) },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  presignDownload(i: { bucket: string; key: string; fileName?: string; expiresInSec?: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: i.bucket,
        Key: i.key,
        ResponseContentDisposition: i.fileName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(i.fileName)}`
          : undefined,
      }),
      { expiresIn: i.expiresInSec ?? 600 },
    );
  }

  async head(i: { bucket: string; key: string }): Promise<{ size: number; contentType?: string | undefined } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: i.bucket, Key: i.key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  async put(i: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: i.bucket,
        Key: i.key,
        Body: i.body,
        ContentType: i.contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async getStream(i: { bucket: string; key: string }): Promise<NodeJS.ReadableStream> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: i.bucket, Key: i.key }));
    if (!r.Body) throw new Error(`Empty object ${i.key}`);
    return r.Body as NodeJS.ReadableStream;
  }

  async delete(i: { bucket: string; key: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: i.bucket, Key: i.key }));
  }
}
