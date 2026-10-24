import { asClass, asValue, Lifetime, type AwilixContainer } from 'awilix';
import type { Redis } from 'ioredis';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { Database } from '../../shared/infrastructure/db/client.js';
import { ClamAvScanner, NoopVirusScanner } from '../../shared/infrastructure/storage/VirusScanner.js';
import type { ModuleContext, ModuleDefinition } from '../../shared/module.js';
import { CompleteUpload, CreateUpload, FILES_QUEUE, GetDownloadUrl } from './application/FileUseCases.js';
import { DrizzleFileRepository } from './infrastructure/DrizzleFileRepository.js';
import { FilesModuleApiImpl } from './infrastructure/FilesModuleApiImpl.js';
import { FilesController, HealthController, JobsController } from './presentation/controllers.js';
import { EnsurePartitionsJob, PurgeExpiredJob, ScanFileJob } from './presentation/jobs.js';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Platform plumbing: health, job status, files, nightly maintenance. */
export class PlatformModule implements ModuleDefinition {
  readonly name = 'platform';
  private container!: AwilixContainer;

  register(container: AwilixContainer, mc: ModuleContext): void {
    this.container = container;
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      virusScanner: asValue(mc.config.CLAMAV_HOST ? new ClamAvScanner(mc.config.CLAMAV_HOST) : new NoopVirusScanner()),
      files: asClass(DrizzleFileRepository, scoped),
      filesApi: asClass(FilesModuleApiImpl, scoped),
      createUpload: asClass(CreateUpload, scoped),
      completeUpload: asClass(CompleteUpload, scoped),
      getDownloadUrl: asClass(GetDownloadUrl, scoped),
    });
    mc.jobs.add({ queue: FILES_QUEUE, name: 'scan', handler: ScanFileJob as never, concurrency: 2 });
    mc.jobs.add({ queue: MAINTENANCE_QUEUE, name: 'purge', handler: PurgeExpiredJob as never });
    mc.jobs.add({ queue: MAINTENANCE_QUEUE, name: 'partitions', handler: EnsurePartitionsJob as never });
    mc.jobs.schedules.push(
      { id: 'maintenance-purge', queue: MAINTENANCE_QUEUE, name: 'purge', cron: '0 3 * * *' },
      { id: 'maintenance-partitions', queue: MAINTENANCE_QUEUE, name: 'partitions', cron: '0 2 * * *' },
    );
  }

  controllers(): BaseController[] {
    const { db, redis } = this.container.cradle as { db: Database; redis: Redis | undefined };
    return [new HealthController({ db, redis }), new JobsController(), new FilesController()];
  }
}
