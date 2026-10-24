import { randomUUID } from 'node:crypto';
import type { FileStorage, JobQueue, PresignedUpload, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { FILE_POLICIES } from './filePolicies.js';

export interface StoredFileRecord {
  id: string;
  orgId: string;
  campusId: string | null;
  bucket: string;
  objectKey: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  purpose: string;
  scanStatus: 'pending' | 'clean' | 'infected' | 'failed' | 'skipped';
  uploadedBy: string | null;
}

export interface FileRepository {
  insert(f: Omit<StoredFileRecord, 'scanStatus'> & { classification: string }): Promise<void>;
  findById(id: string): Promise<StoredFileRecord | null>;
  setScanStatus(id: string, status: StoredFileRecord['scanStatus']): Promise<void>;
}

export const FILES_QUEUE = 'files';

/** Step 1: validate purpose/type/size, create sys.stored_file (pending) and return a presigned PUT. */
export class CreateUpload extends UseCase<
  { purpose: string; fileName: string; mimeType: string; sizeBytes: number },
  { fileId: string; upload: PresignedUpload }
> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      ctx: RequestContext;
      scopePolicy: ScopePolicy;
      files: FileRepository;
      fileStorage: FileStorage;
      config: { S3_BUCKET_PRIVATE: string };
    },
  ) {
    super(d.uow);
  }

  protected async handle(i: { purpose: string; fileName: string; mimeType: string; sizeBytes: number }) {
    const policy = FILE_POLICIES[i.purpose];
    if (!policy) throw new InvariantError('FILE_PURPOSE_UNKNOWN', `Unknown upload purpose ${i.purpose}`);
    if (policy.uploadPermission && !this.d.scopePolicy.has(policy.uploadPermission)) throw new ForbiddenError();
    if (!policy.mimeTypes.includes(i.mimeType))
      throw new InvariantError('FILE_TYPE_NOT_ALLOWED', `Type ${i.mimeType} is not allowed`);
    if (i.sizeBytes <= 0 || i.sizeBytes > policy.maxBytes) {
      throw new InvariantError('FILE_TOO_LARGE', `Maximum size is ${Math.floor(policy.maxBytes / 1024 / 1024)} MB`);
    }
    const id = randomUUID();
    const now = new Date();
    // no PII in object keys
    const objectKey = `${this.d.ctx.orgId}/${i.purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    const bucket = this.d.config.S3_BUCKET_PRIVATE;
    await this.d.files.insert({
      id,
      orgId: this.d.ctx.orgId,
      campusId: this.d.ctx.activeCampusId ?? null,
      bucket,
      objectKey,
      originalName: i.fileName.slice(0, 255),
      mimeType: i.mimeType,
      sizeBytes: i.sizeBytes,
      purpose: i.purpose,
      uploadedBy: this.d.ctx.userId,
      classification: policy.classification,
    });
    const upload = await this.d.fileStorage.presignUpload({
      bucket,
      key: objectKey,
      contentType: i.mimeType,
      contentLength: i.sizeBytes,
    });
    return { fileId: id, upload };
  }
}

/** Step 3 (after the client PUT): verify the object exists with the declared size, then queue the virus scan. */
export class CompleteUpload extends UseCase<{ fileId: string }, { fileId: string; scanStatus: string }> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      ctx: RequestContext;
      files: FileRepository;
      fileStorage: FileStorage;
      jobQueue: JobQueue;
    },
  ) {
    super(d.uow);
  }

  protected async handle({ fileId }: { fileId: string }) {
    const file = await this.d.files.findById(fileId);
    if (!file || file.uploadedBy !== this.d.ctx.userId) throw new NotFoundError();
    if (file.scanStatus !== 'pending') return { fileId, scanStatus: file.scanStatus };
    const head = await this.d.fileStorage.head({ bucket: file.bucket, key: file.objectKey });
    if (!head) throw new ConflictError('FILE_NOT_UPLOADED', 'Upload the file before completing');
    if (head.size !== file.sizeBytes)
      throw new InvariantError('FILE_SIZE_MISMATCH', 'Uploaded size differs from declared size');
    await this.d.jobQueue.enqueue(FILES_QUEUE, 'scan', { orgId: file.orgId, fileId }, { jobId: `scan-${fileId}` });
    return { fileId, scanStatus: 'pending' };
  }
}

/** Presigned download after permission check; infected/unscanned files are never served. */
export class GetDownloadUrl extends Query<{ fileId: string }, { url: string; expiresInSec: number }> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      ctx: RequestContext;
      scopePolicy: ScopePolicy;
      files: FileRepository;
      fileStorage: FileStorage;
    },
  ) {
    super(d.uow);
  }

  protected async handle({ fileId }: { fileId: string }) {
    const file = await this.d.files.findById(fileId);
    if (!file) throw new NotFoundError();
    const policy = FILE_POLICIES[file.purpose];
    const isOwner = file.uploadedBy === this.d.ctx.userId;
    const allowed = isOwner || (policy?.readPermission ? this.d.scopePolicy.has(policy.readPermission) : false);
    if (!allowed) throw new NotFoundError();
    if (file.scanStatus !== 'clean' && file.scanStatus !== 'skipped') {
      throw new ConflictError('FILE_NOT_AVAILABLE', `File is ${file.scanStatus}`);
    }
    const expiresInSec = 600;
    const url = await this.d.fileStorage.presignDownload({
      bucket: file.bucket,
      key: file.objectKey,
      fileName: file.originalName ?? undefined,
      expiresInSec,
    });
    return { url, expiresInSec };
  }
}
