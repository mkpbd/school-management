import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import type { FileStorage } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { FileRepository } from '../application/FileUseCases.js';
import type { FileInfo, FilesModuleApi } from '../public-api/FilesModuleApi.js';

export class FilesModuleApiImpl implements FilesModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; files: FileRepository; fileStorage: FileStorage }) {}

  getFile(fileId: string): Promise<FileInfo | null> {
    return this.d.uow.run(async () => {
      const f = await this.d.files.findById(fileId);
      return f
        ? {
            id: f.id,
            purpose: f.purpose,
            scanStatus: f.scanStatus,
            uploadedBy: f.uploadedBy,
            mimeType: f.mimeType,
            originalName: f.originalName,
          }
        : null;
    });
  }

  async requireUsable(fileId: string, purpose: string): Promise<FileInfo> {
    const f = await this.getFile(fileId);
    if (!f) throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    if (f.purpose !== purpose)
      throw new InvariantError('FILE_PURPOSE_MISMATCH', `File was uploaded for ${f.purpose}, not ${purpose}`);
    if (f.scanStatus !== 'clean' && f.scanStatus !== 'skipped') {
      throw new ConflictError(
        'FILE_NOT_AVAILABLE',
        `File is ${f.scanStatus}; complete the upload and wait for the scan`,
      );
    }
    return f;
  }

  async downloadUrl(fileId: string, purpose: string) {
    const info = await this.requireUsable(fileId, purpose);
    const f = (await this.d.uow.run(() => this.d.files.findById(fileId)))!;
    const expiresInSec = 600;
    const url = await this.d.fileStorage.presignDownload({
      bucket: f.bucket,
      key: f.objectKey,
      fileName: info.originalName ?? undefined,
      expiresInSec,
    });
    return { url, expiresInSec, fileName: info.originalName };
  }
}
