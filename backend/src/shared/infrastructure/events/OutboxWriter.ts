import { sql } from 'drizzle-orm';
import type { DomainEvent } from '../../domain/DomainEvent.js';
import { moduleOf } from '../../domain/DomainEvent.js';
import type { EventPublisher } from '../../application/ports.js';
import { outboxEvent } from '../db/schema/sys.js';
import type { UnitOfWork } from '../db/UnitOfWork.js';

/**
 * Writes domain events into sys.outbox_event inside the current business transaction, then NOTIFY.
 * PostgreSQL delivers the notification only on COMMIT, so the relay never sees uncommitted events.
 */
export class OutboxWriter implements EventPublisher {
  private readonly uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.uow = deps.uow;
  }

  async write(events: DomainEvent[]): Promise<void> {
    if (!events.length) return;
    const tx = this.uow.tx();
    await tx.insert(outboxEvent).values(
      events.map((e) => ({
        orgId: e.orgId,
        module: moduleOf(e.type),
        eventType: e.type,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: { ...e.payload, ...(e.campusId ? { __campusId: e.campusId } : {}) },
        occurredAt: e.occurredAt,
      })),
    );
    await tx.execute(sql`SELECT pg_notify('outbox', '')`);
  }
}
