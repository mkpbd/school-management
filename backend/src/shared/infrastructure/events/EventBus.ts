import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { PublishedEvent } from '../../domain/DomainEvent.js';
import type { SubscriptionRunner } from './SubscriptionRunner.js';

/** Fans a published outbox event out to its consumers. */
export interface EventBus {
  publish(event: PublishedEvent, consumers: string[]): Promise<void>;
}

export const EVENTS_QUEUE = 'events';

/** Production: one BullMQ job per (event, consumer); jobId de-duplicates relay retries. */
export class BullMqEventBus implements EventBus {
  constructor(private readonly queue: Queue) {}

  async publish(event: PublishedEvent, consumers: string[]): Promise<void> {
    await this.queue.addBulk(
      consumers.map((consumer) => ({
        name: consumer,
        data: { event, consumer },
        opts: {
          jobId: `${event.eventId}__${consumer}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: false,
        },
      })),
    );
  }
}

/** Development/tests without Redis: deliver in-process right away (errors are logged, event stays retryable). */
export class InlineEventBus implements EventBus {
  constructor(
    private readonly runner: () => SubscriptionRunner,
    private readonly logger: Logger,
  ) {}

  async publish(event: PublishedEvent, consumers: string[]): Promise<void> {
    for (const consumer of consumers) {
      try {
        await this.runner().deliver(event, consumer);
      } catch (err) {
        this.logger.error({ err, consumer, eventId: event.eventId }, 'inline event delivery failed');
      }
    }
  }
}
