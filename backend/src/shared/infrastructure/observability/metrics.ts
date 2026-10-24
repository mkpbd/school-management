import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

/** Prometheus metrics (docs/backend/cross-cutting.md §18). One registry per process. */
export class Metrics {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route template',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly useCaseDuration = new Histogram({
    name: 'usecase_duration_seconds',
    help: 'Use case execution time',
    labelNames: ['name', 'outcome'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly outboxLag = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age of the oldest unpublished outbox event',
    registers: [this.registry],
  });

  readonly eventsHandled = new Counter({
    name: 'events_handled_total',
    help: 'Domain events handled by subscribers',
    labelNames: ['consumer', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly jobsProcessed = new Counter({
    name: 'jobs_processed_total',
    help: 'Background jobs processed',
    labelNames: ['queue', 'name', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly notificationsQueued = new Counter({
    name: 'notifications_queued_total',
    help: 'Outbound messages queued',
    labelNames: ['channel', 'event'] as const,
    registers: [this.registry],
  });

  readonly authEvents = new Counter({
    name: 'auth_events_total',
    help: 'Authentication outcomes',
    labelNames: ['kind', 'outcome'] as const,
    registers: [this.registry],
  });

  constructor(collectDefaults = true) {
    if (collectDefaults) collectDefaultMetrics({ register: this.registry });
  }
}
