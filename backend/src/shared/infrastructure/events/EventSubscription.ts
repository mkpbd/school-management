import type { EventType, PublishedEvent } from '../../domain/DomainEvent.js';

/**
 * An idempotent consumer of one event type. Instances are created per event in a scoped container with a
 * system RequestContext for the event's organisation, so they can use UnitOfWork, repositories and public APIs.
 */
export interface EventSubscriber<P = Record<string, unknown>> {
  handle(event: PublishedEvent<P>): Promise<void>;
}

export interface SubscriptionDescriptor {
  /** Event type consumed, e.g. 'att.student_marked_absent.v1'. */
  eventType: EventType;
  /** Unique consumer name, recorded in sys.processed_event (inbox), e.g. 'com.absence_alert'. */
  consumer: string;
  handler: new (deps: never) => EventSubscriber<never>;
}

export class SubscriptionRegistry {
  private readonly byConsumer = new Map<string, SubscriptionDescriptor>();

  add(descriptor: SubscriptionDescriptor): void {
    if (this.byConsumer.has(descriptor.consumer)) throw new Error(`Duplicate consumer ${descriptor.consumer}`);
    this.byConsumer.set(descriptor.consumer, descriptor);
  }

  consumersFor(eventType: string): string[] {
    return [...this.byConsumer.values()].filter((d) => d.eventType === eventType).map((d) => d.consumer);
  }

  get(consumer: string): SubscriptionDescriptor | undefined {
    return this.byConsumer.get(consumer);
  }

  all(): SubscriptionDescriptor[] {
    return [...this.byConsumer.values()];
  }
}
