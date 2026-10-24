import type { PublishedEvent } from '../../../shared/domain/DomainEvent.js';
import type { PostPayrollJournal, PostPayrollPayment } from '../application/AccountingUseCases.js';

/** HRM-04 -> ACC: a locked payroll becomes the month's salary journal (idempotent per run). */
export class OnPayrollLocked {
  constructor(private readonly d: { postPayrollJournal: PostPayrollJournal }) {}

  async handle(
    e: PublishedEvent<{
      runId: string;
      month: string;
      components: Array<{ code: string; kind: string; amountPaisa: number }>;
    }>,
  ): Promise<void> {
    if (!e.campusId || !e.payload.components?.length) return;
    await this.d.postPayrollJournal.execute({
      runId: e.payload.runId,
      campusId: e.campusId,
      month: e.payload.month,
      components: e.payload.components,
    });
  }
}

/** Salaries transferred: Dr salaries payable / Cr bank. */
export class OnPayrollPaid {
  constructor(private readonly d: { postPayrollPayment: PostPayrollPayment }) {}

  async handle(
    e: PublishedEvent<{ runId: string; month: string; netPaisa: number; paymentReference: string; paidOn: string }>,
  ): Promise<void> {
    if (!e.campusId) return;
    await this.d.postPayrollPayment.execute({ ...e.payload, campusId: e.campusId });
  }
}
