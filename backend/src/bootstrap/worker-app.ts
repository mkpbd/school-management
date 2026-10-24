import type { AwilixContainer } from 'awilix';
import { Worker, type Job } from 'bullmq';
import { EVENTS_QUEUE, type EventBus } from '../shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../shared/infrastructure/events/OutboxRelay.js';
import type { SubscriptionRunner } from '../shared/infrastructure/events/SubscriptionRunner.js';
import { LeaderElection } from '../shared/infrastructure/queue/LeaderElection.js';
import type { JobPayload, JobRegistry, JobRunner } from '../shared/infrastructure/queue/jobs.js';
import type { PublishedEvent } from '../shared/domain/DomainEvent.js';
import type { Cradle } from './container.js';
import { Queue } from 'bullmq';

export interface WorkerApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  relay: OutboxRelay;
}

/**
 * Worker process (docs/backend/cross-cutting.md §10): BullMQ processors for every registered queue,
 * plus a leader-elected scheduler and outbox relay. Without Redis (development) the relay runs in-process and
 * interval schedules use timers.
 */
export function createWorkerApp(container: AwilixContainer<Cradle>, options: { queues?: string[] } = {}): WorkerApp {
  const { logger, redis, orgId, db, pool, metrics } = container.cradle;
  const jobs = container.resolve<JobRegistry>('jobs');
  const subscriptions = container.resolve<SubscriptionRegistry>('subscriptions');
  const jobRunner = container.resolve<JobRunner>('jobRunner');
  const subscriptionRunner = container.resolve<SubscriptionRunner>('subscriptionRunner');
  const relay = new OutboxRelay({
    db,
    pool,
    eventBus: container.resolve<EventBus>('eventBus'),
    subscriptions,
    logger,
    metrics,
  });

  const workers: Worker[] = [];
  const timers: NodeJS.Timeout[] = [];
  let leader: LeaderElection | undefined;

  const startSchedules = async () => {
    for (const s of jobs.schedules) {
      if (redis) {
        const queue = new Queue(s.queue, { connection: redis, prefix: 'sms' });
        await queue.upsertJobScheduler(
          s.id,
          s.cron ? { pattern: s.cron, tz: 'Asia/Dhaka' } : { every: s.everyMs ?? 60_000 },
          { name: s.name, data: { orgId, ...s.data } },
        );
        await queue.close();
      } else if (s.everyMs) {
        timers.push(
          setInterval(() => {
            jobRunner.run(s.queue, s.name, { orgId, ...s.data }).catch(() => undefined);
          }, s.everyMs),
        );
      } else {
        logger.warn({ schedule: s.id }, 'cron schedules need Redis; skipped in development');
      }
    }
  };

  return {
    relay,
    async start() {
      if (redis) {
        const wanted = options.queues ?? [EVENTS_QUEUE, ...jobs.queues()];
        for (const queue of wanted) {
          const worker = new Worker(
            queue,
            async (job: Job) => {
              if (queue === EVENTS_QUEUE) {
                const { event, consumer } = job.data as { event: PublishedEvent; consumer: string };
                await subscriptionRunner.deliver(event, consumer);
                return;
              }
              await jobRunner.run(queue, job.name, job.data as JobPayload, {
                attempt: job.attemptsMade + 1,
                updateProgress: async (p) => {
                  await job.updateProgress(p);
                },
              });
            },
            { connection: redis, prefix: 'sms', concurrency: queue === EVENTS_QUEUE ? 10 : jobs.concurrencyOf(queue) },
          );
          worker.on('failed', (job, err) =>
            logger.warn({ queue, job: job?.name, err: err.message }, 'job attempt failed'),
          );
          workers.push(worker);
        }
        leader = new LeaderElection(
          redis,
          logger,
          async () => {
            await relay.start();
            await startSchedules();
          },
          async () => relay.stop(),
        );
        await leader.start();
      } else {
        await relay.start();
        await startSchedules();
      }
      logger.info({ queues: redis ? (options.queues ?? 'all') : 'inline' }, 'worker started');
    },
    async stop() {
      timers.forEach(clearInterval);
      await leader?.stop();
      await relay.stop();
      await Promise.allSettled(workers.map((w) => w.close()));
    },
  };
}
