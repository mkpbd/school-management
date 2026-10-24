import { inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { EventType, PublishedEvent } from '../../domain/DomainEvent.js';
import type { Database } from '../db/client.js';
import { outboxEvent } from '../db/schema/sys.js';
import type { Metrics } from '../observability/metrics.js';
import type { EventBus } from './EventBus.js';
import type { SubscriptionRegistry } from './EventSubscription.js';

type OutboxRow = {
  id: number;
  event_id: string;
  org_id: string;
  module: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
};

/**
 * Moves committed events from sys.outbox_event to the event bus (leader-only, docs/backend/cross-cutting.md §9.2).
 * Woken by LISTEN outbox; polls every second as a safety net. FOR UPDATE SKIP LOCKED allows a standby relay.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private listener: pg.PoolClient | undefined;
  private draining = false;
  private again = false;
  private stopped = true;

  constructor(
    private readonly deps: {
      db: Database;
      pool: pg.Pool;
      eventBus: EventBus;
      subscriptions: SubscriptionRegistry;
      logger: Logger;
      metrics: Metrics;
      pollIntervalMs?: number;
      batchSize?: number;
    },
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.listener = await this.deps.pool.connect();
    this.listener.on('notification', () => void this.drain());
    await this.listener.query('LISTEN outbox');
    this.timer = setInterval(() => void this.drain(), this.deps.pollIntervalMs ?? 1_000);
    await this.drain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.listener) {
      await this.listener.query('UNLISTEN outbox').catch(() => undefined);
      this.listener.release();
      this.listener = undefined;
    }
  }

  /** Publishes all pending events; safe to call concurrently (coalesces). Returns the number published. */
  async drain(): Promise<number> {
    if (this.draining) {
      this.again = true;
      return 0;
    }
    this.draining = true;
    let total = 0;
    try {
      do {
        this.again = false;
        let batch: number;
        do {
          batch = await this.publishBatch();
          total += batch;
        } while (batch > 0 && !this.stopped);
      } while (this.again && !this.stopped);
      await this.updateLag();
    } catch (err) {
      this.deps.logger.error({ err }, 'outbox relay failed');
    } finally {
      this.draining = false;
    }
    return total;
  }

  private async publishBatch(): Promise<number> {
    const limit = this.deps.batchSize ?? 200;
    return this.deps.db.transaction(async (tx) => {
      const result = await tx.execute<OutboxRow>(sql`
        SELECT id, event_id, org_id, module, event_type, aggregate_type, aggregate_id, payload, occurred_at
          FROM sys.outbox_event WHERE published_at IS NULL
         ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      if (!result.rows.length) return 0;
      for (const row of result.rows) {
        const { __campusId, ...payload } = row.payload as Record<string, unknown> & { __campusId?: string };
        const event: PublishedEvent = {
          eventId: row.event_id,
          type: row.event_type as EventType,
          module: row.module,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          orgId: row.org_id,
          campusId: __campusId,
          occurredAt: new Date(row.occurred_at).toISOString(),
          payload,
        };
        const consumers = this.deps.subscriptions.consumersFor(row.event_type);
        if (consumers.length) await this.deps.eventBus.publish(event, consumers);
      }
      await tx
        .update(outboxEvent)
        .set({ publishedAt: sql`now()`, attempts: sql`${outboxEvent.attempts} + 1` })
        .where(
          inArray(
            outboxEvent.id,
            result.rows.map((r) => Number(r.id)),
          ),
        );
      return result.rows.length;
    });
  }

  private async updateLag(): Promise<void> {
    const r = await this.deps.db.execute<{ lag: number | null }>(sql`
      SELECT extract(epoch FROM now() - min(occurred_at))::float8 AS lag FROM sys.outbox_event WHERE published_at IS NULL`);
    this.deps.metrics.outboxLag.set(r.rows[0]?.lag ?? 0);
  }
}
