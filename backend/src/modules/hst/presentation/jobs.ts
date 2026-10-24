import type { Logger } from 'pino';
import type { JobHandler } from '../../../shared/infrastructure/queue/jobs.js';
import type { AlertOverdueOutpasses } from '../application/HostelUseCases.js';

export const HST_QUEUE = 'hst';

/** Every 10 minutes: students still out after their out-pass return time. */
export class OverdueOutpassJob implements JobHandler {
  constructor(private readonly d: { alertOverdueOutpasses: AlertOverdueOutpasses; logger: Logger }) {}

  async handle(): Promise<void> {
    const r = await this.d.alertOverdueOutpasses.execute({});
    if (r.overdue) this.d.logger.warn(r, 'hostel out-passes overdue');
  }
}
