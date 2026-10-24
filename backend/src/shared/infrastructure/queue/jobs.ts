import { asValue, type AwilixContainer } from 'awilix';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { systemContext } from '../../application/RequestContext.js';
import type { EnqueueOptions, JobQueue } from '../../application/ports.js';
import { logContext } from '../observability/logger.js';
import type { Metrics } from '../observability/metrics.js';

/** Every job payload carries the organisation it runs for (system RequestContext is built from it). */
export interface JobPayload {
  orgId: string;
  [key: string]: unknown;
}

export interface JobContext {
  queue: string;
  name: string;
  attempt: number;
  updateProgress(percent: number): Promise<void>;
}

/** A background job. Instances are built per job in a scoped container with a system context. */
export interface JobHandler<D extends JobPayload = JobPayload> {
  handle(data: D, job: JobContext): Promise<void>;
}

export interface JobDescriptor {
  queue: string;
  name: string;
  handler: new (deps: never) => JobHandler<never>;
  /** BullMQ worker concurrency for this queue (max over its jobs). */
  concurrency?: number;
}

export interface ScheduleDescriptor {
  id: string;
  queue: string;
  name: string;
  /** cron (Asia/Dhaka) or fixed interval */
  cron?: string;
  everyMs?: number;
  data?: Record<string, unknown>;
}

export class JobRegistry {
  private readonly jobs = new Map<string, JobDescriptor>();
  readonly schedules: ScheduleDescriptor[] = [];

  add(descriptor: JobDescriptor): void {
    const key = `${descriptor.queue}/${descriptor.name}`;
    if (this.jobs.has(key)) throw new Error(`Duplicate job ${key}`);
    this.jobs.set(key, descriptor);
  }

  get(queue: string, name: string): JobDescriptor | undefined {
    return this.jobs.get(`${queue}/${name}`);
  }

  queues(): string[] {
    return [...new Set([...this.jobs.values()].map((j) => j.queue))];
  }

  concurrencyOf(queue: string): number {
    return Math.max(1, ...[...this.jobs.values()].filter((j) => j.queue === queue).map((j) => j.concurrency ?? 1));
  }
}

/** Runs one job: scoped container, system context, logging and metrics. */
export class JobRunner {
  constructor(
    private readonly deps: { container: AwilixContainer; jobs: JobRegistry; logger: Logger; metrics: Metrics },
  ) {}

  async run(queue: string, name: string, data: JobPayload, meta: Partial<JobContext> = {}): Promise<void> {
    const descriptor = this.deps.jobs.get(queue, name);
    if (!descriptor) throw new Error(`No handler for job ${queue}/${name}`);
    const requestId = `job-${queue}-${name}-${Date.now().toString(36)}`;
    const scope = this.deps.container.createScope();
    scope.register({ ctx: asValue(systemContext(data.orgId, requestId)) });
    const started = performance.now();
    try {
      const handler = scope.build(descriptor.handler as never) as JobHandler;
      await logContext.run({ requestId, orgId: data.orgId, job: `${queue}/${name}` }, () =>
        handler.handle(data, {
          queue,
          name,
          attempt: meta.attempt ?? 1,
          updateProgress: meta.updateProgress ?? (async () => undefined),
        }),
      );
      this.deps.metrics.jobsProcessed.inc({ queue, name, outcome: 'ok' });
    } catch (err) {
      this.deps.metrics.jobsProcessed.inc({ queue, name, outcome: 'failed' });
      this.deps.logger.error({ err, queue, name, ms: Math.round(performance.now() - started) }, 'job failed');
      throw err;
    } finally {
      await scope.dispose();
    }
  }
}

/** Production queue: BullMQ (Redis). */
export class BullMqJobQueue implements JobQueue {
  constructor(private readonly queueFor: (name: string) => Queue) {}

  async enqueue<T>(queue: string, name: string, data: T, options: EnqueueOptions = {}): Promise<void> {
    await this.queueFor(queue).add(name, data, {
      jobId: options.jobId,
      delay: options.delayMs,
      priority: options.priority,
      attempts: options.attempts ?? 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 7 * 86_400 },
    });
  }
}

/**
 * Development/tests without Redis: runs the job in-process.
 * `awaitJobs: true` (tests) awaits completion; otherwise it runs in the background after the current tick.
 */
export class InlineJobQueue implements JobQueue {
  private readonly seen = new Set<string>();

  constructor(
    private readonly runner: () => JobRunner,
    private readonly logger: Logger,
    private readonly awaitJobs = false,
  ) {}

  async enqueue<T>(queue: string, name: string, data: T, options: EnqueueOptions = {}): Promise<void> {
    if (options.jobId) {
      if (this.seen.has(options.jobId)) return;
      this.seen.add(options.jobId);
    }
    const exec = () => this.runner().run(queue, name, data as JobPayload);
    if (this.awaitJobs) {
      await exec();
      return;
    }
    setTimeout(
      () => exec().catch((err) => this.logger.error({ err, queue, name }, 'inline job failed')),
      options.delayMs ?? 0,
    );
  }
}
