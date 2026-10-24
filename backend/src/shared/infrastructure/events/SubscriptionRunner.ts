import { asValue, type AwilixContainer } from 'awilix';
import type { Logger } from 'pino';
import type { PublishedEvent } from '../../domain/DomainEvent.js';
import { systemContext } from '../../application/RequestContext.js';
import { processedEvent } from '../db/schema/sys.js';
import type { UnitOfWork } from '../db/UnitOfWork.js';
import type { Metrics } from '../observability/metrics.js';
import { logContext } from '../observability/logger.js';
import type { SubscriptionRegistry } from './EventSubscription.js';

/**
 * Delivers one event to one consumer with an exactly-once effect (docs/backend/cross-cutting.md §9.2):
 * the inbox row (sys.processed_event) and the handler's writes commit in the same transaction.
 */
export class SubscriptionRunner {
  private readonly container: AwilixContainer;
  private readonly subscriptions: SubscriptionRegistry;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  constructor(deps: {
    container: AwilixContainer;
    subscriptions: SubscriptionRegistry;
    logger: Logger;
    metrics: Metrics;
  }) {
    this.container = deps.container;
    this.subscriptions = deps.subscriptions;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
  }

  async deliver(event: PublishedEvent, consumer: string): Promise<'handled' | 'duplicate'> {
    const descriptor = this.subscriptions.get(consumer);
    if (!descriptor) throw new Error(`Unknown consumer ${consumer}`);
    const scope = this.container.createScope();
    scope.register({ ctx: asValue(systemContext(event.orgId, `evt-${event.eventId}`)) });
    const uow = scope.resolve<UnitOfWork>('uow');
    try {
      return await logContext
        .run({ requestId: `evt-${event.eventId}`, orgId: event.orgId, job: consumer }, () =>
          uow.run(async () => {
            const inserted = await uow
              .tx()
              .insert(processedEvent)
              .values({ consumer, eventId: event.eventId })
              .onConflictDoNothing()
              .returning({ eventId: processedEvent.eventId });
            if (!inserted.length) return 'duplicate' as const;
            const handler = scope.build(descriptor.handler as never) as { handle(e: PublishedEvent): Promise<void> };
            await handler.handle(event);
            return 'handled' as const;
          }),
        )
        .then((outcome) => {
          this.metrics.eventsHandled.inc({ consumer, outcome });
          return outcome;
        });
    } catch (err) {
      this.metrics.eventsHandled.inc({ consumer, outcome: 'failed' });
      this.logger.error({ err, consumer, eventType: event.type, eventId: event.eventId }, 'event handler failed');
      throw err;
    } finally {
      await scope.dispose();
    }
  }
}
