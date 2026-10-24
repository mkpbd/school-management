import { and, eq, isNull } from 'drizzle-orm';
import { storedFile } from '../../../shared/infrastructure/db/schema/sys.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { FileRepository, StoredFileRecord } from '../application/FileUseCases.js';

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  async insert(f: Omit<StoredFileRecord, 'scanStatus'> & { classification: string }): Promise<void> {
    await this.d.uow
      .tx()
      .insert(storedFile)
      .values({
        id: f.id,
        orgId: f.orgId,
        campusId: f.campusId,
        bucket: f.bucket,
        objectKey: f.objectKey,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        purpose: f.purpose,
        classification: f.classification as 'public' | 'internal' | 'confidential' | 'restricted',
        uploadedBy: f.uploadedBy,
      });
  }

  async findById(id: string): Promise<StoredFileRecord | null> {
    const [row] = await this.d.uow
      .tx()
      .select({
        id: storedFile.id,
        orgId: storedFile.orgId,
        campusId: storedFile.campusId,
        bucket: storedFile.bucket,
        objectKey: storedFile.objectKey,
        originalName: storedFile.originalName,
        mimeType: storedFile.mimeType,
        sizeBytes: storedFile.sizeBytes,
        purpose: storedFile.purpose,
        scanStatus: storedFile.scanStatus,
        uploadedBy: storedFile.uploadedBy,
      })
      .from(storedFile)
      .where(and(eq(storedFile.id, id), isNull(storedFile.deletedAt)));
    return row ?? null;
  }

  async setScanStatus(id: string, status: StoredFileRecord['scanStatus']): Promise<void> {
    await this.d.uow.tx().update(storedFile).set({ scanStatus: status }).where(eq(storedFile.id, id));
  }
}
