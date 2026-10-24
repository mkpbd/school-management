import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AuditLog } from '../../../shared/application/AuditLog.js';
import type { FileStorage } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { JobHandler, JobPayload } from '../../../shared/infrastructure/queue/jobs.js';
import type { VirusScanner } from '../../../shared/infrastructure/storage/VirusScanner.js';
import type { FileRepository } from '../application/FileUseCases.js';

/** files/scan: ClamAV scan of an uploaded object; infected objects are deleted and audited. */
export class ScanFileJob implements JobHandler<JobPayload & { fileId: string }> {
  constructor(
    private readonly d: {
      uow: UnitOfWork;
      files: FileRepository;
      fileStorage: FileStorage;
      virusScanner: VirusScanner;
      auditLog: AuditLog;
      logger: Logger;
    },
  ) {}

  async handle(data: JobPayload & { fileId: string }): Promise<void> {
    const file = await this.d.uow.run(() => this.d.files.findById(data.fileId));
    if (!file || file.scanStatus !== 'pending') return;
    const result = await this.d.virusScanner.scan(
      await this.d.fileStorage.getStream({ bucket: file.bucket, key: file.objectKey }),
    );
    if (result.status === 'infected') {
      await this.d.fileStorage.delete({ bucket: file.bucket, key: file.objectKey });
      this.d.logger.warn({ fileId: file.id, signature: result.signature }, 'infected upload removed');
    }
    await this.d.uow.run(async () => {
      await this.d.files.setScanStatus(file.id, result.status);
      if (result.status === 'infected') {
        await this.d.auditLog.record({
          action: 'FILE_INFECTED',
          entityType: 'stored_file',
          entityId: file.id,
          details: { signature: result.signature },
          actorUserId: file.uploadedBy,
        });
      }
    });
  }
}

/** maintenance/purge (nightly): expired idempotency keys, dedupe keys, OTPs, old revoked refresh tokens. */
export class PurgeExpiredJob implements JobHandler {
  constructor(private readonly d: { uow: UnitOfWork; logger: Logger }) {}

  async handle(): Promise<void> {
    const counts = await this.d.uow.run(async () => {
      const tx = this.d.uow.tx();
      const run = async (q: ReturnType<typeof sql>) => (await tx.execute(q)).rowCount ?? 0;
      return {
        idempotency: await run(sql`DELETE FROM sys.idempotency_key WHERE expires_at < now()`),
        dedupe: await run(sql`DELETE FROM com.message_dedupe WHERE created_at < now() - interval '30 days'`),
        otp: await run(sql`DELETE FROM iam.otp_challenge WHERE expires_at < now() - interval '1 day'`),
        refresh: await run(
          sql`DELETE FROM iam.refresh_token WHERE (revoked_at IS NOT NULL OR expires_at < now()) AND issued_at < now() - interval '90 days'`,
        ),
      };
    });
    this.d.logger.info(counts, 'purge completed');
  }
}

/** maintenance/partitions (nightly): stay ahead with core.ensure_partitions; warn if any DEFAULT partition holds rows. */
export class EnsurePartitionsJob implements JobHandler {
  constructor(private readonly d: { uow: UnitOfWork; logger: Logger }) {}

  async handle(): Promise<void> {
    await this.d.uow.run(async () => {
      const tx = this.d.uow.tx();
      await tx.execute(sql`SELECT core.ensure_partitions('att.student_daily_attendance', 'year', current_date, 2),
                                  core.ensure_partitions('att.period_attendance', 'year', current_date, 2),
                                  core.ensure_partitions('att.staff_attendance', 'year', current_date, 2),
                                  core.ensure_partitions('att.device_event', 'month', current_date, 3),
                                  core.ensure_partitions('sec.gate_event', 'month', current_date, 3),
                                  core.ensure_partitions('com.outbound_message', 'month', current_date, 3),
                                  core.ensure_partitions('audit.audit_event', 'month', current_date, 3),
                                  core.ensure_partitions('trn.gps_ping', 'day', current_date, 14)`);
    });
  }
}
