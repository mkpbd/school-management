import type { Logger } from 'pino';
import type { JobHandler } from '../../../shared/infrastructure/queue/jobs.js';
import type { ExpireReservations, SendOverdueReminders } from '../application/LibraryUseCases.js';

export const LIB_QUEUE = 'lib';

/** Daily: overdue reminders to guardians / staff (lib.overdue_reminder_days). */
export class OverdueRemindersJob implements JobHandler {
  constructor(private readonly d: { sendOverdueReminders: SendOverdueReminders; logger: Logger }) {}

  async handle(): Promise<void> {
    const r = await this.d.sendOverdueReminders.execute({});
    this.d.logger.info(r, 'library overdue reminders');
  }
}

/** Hourly: ready reservations not collected in time expire and the copy moves on. */
export class ExpireReservationsJob implements JobHandler {
  constructor(private readonly d: { expireReservations: ExpireReservations; logger: Logger }) {}

  async handle(): Promise<void> {
    const r = await this.d.expireReservations.execute({});
    if (r.expired) this.d.logger.info(r, 'library reservations expired');
  }
}
