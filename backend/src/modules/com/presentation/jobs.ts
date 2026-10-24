import type { JobHandler } from '../../../shared/infrastructure/queue/jobs.js';
import type { PublishDueNotices } from '../application/NoticeUseCases.js';

export const COM_QUEUE = 'com';

/** Every minute: scheduled notices whose publish time has come. */
export class PublishDueNoticesJob implements JobHandler {
  constructor(private readonly d: { publishDueNotices: PublishDueNotices }) {}

  async handle(): Promise<void> {
    await this.d.publishDueNotices.execute({});
  }
}
