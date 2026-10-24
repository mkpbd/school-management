import { createHash, createHmac } from 'node:crypto';
import { asClass, asFunction, asValue, createContainer, InjectionMode, Lifetime, type AwilixContainer } from 'awilix';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type pg from 'pg';
import type { Logger } from 'pino';
import { ScopePolicy, type ScopeResolver } from '../shared/application/ScopePolicy.js';
import { SystemClock, type Clock } from '../shared/domain/Clock.js';
import { DbAuditLog } from '../shared/infrastructure/audit/DbAuditLog.js';
import { MemoryCache, RedisCache } from '../shared/infrastructure/cache/cache.js';
import { RateLimiterFactory } from '../shared/infrastructure/cache/rateLimiter.js';
import { AesGcmFieldCipher, HmacBlindIndexer } from '../shared/infrastructure/crypto/FieldCipher.js';
import { PasswordHasher } from '../shared/infrastructure/crypto/PasswordHasher.js';
import { TokenService } from '../shared/infrastructure/crypto/TokenService.js';
import { createDatabase, createPool, type Database } from '../shared/infrastructure/db/client.js';
import { PgNumberAllocator } from '../shared/infrastructure/db/NumberAllocator.js';
import { UnitOfWork } from '../shared/infrastructure/db/UnitOfWork.js';
import {
  BullMqEventBus,
  EVENTS_QUEUE,
  InlineEventBus,
  type EventBus,
} from '../shared/infrastructure/events/EventBus.js';
import { SubscriptionRegistry } from '../shared/infrastructure/events/EventSubscription.js';
import { OutboxWriter } from '../shared/infrastructure/events/OutboxWriter.js';
import { SubscriptionRunner } from '../shared/infrastructure/events/SubscriptionRunner.js';
import { IdempotencyStore } from '../shared/infrastructure/idempotency/IdempotencyStore.js';
import { createLogger } from '../shared/infrastructure/observability/logger.js';
import { Metrics } from '../shared/infrastructure/observability/metrics.js';
import { BullMqJobQueue, InlineJobQueue, JobRegistry, JobRunner } from '../shared/infrastructure/queue/jobs.js';
import { LocalDiskFileStorage } from '../shared/infrastructure/storage/LocalDiskFileStorage.js';
import { S3FileStorage } from '../shared/infrastructure/storage/S3FileStorage.js';
import { ScopeResolverRegistry, type ModuleDefinition } from '../shared/module.js';
import type { AppConfig } from './config.js';

export type ProcessRole = 'api' | 'worker';

export interface ContainerOptions {
  role: ProcessRole;
  /** tests: run inline jobs synchronously */
  awaitInlineJobs?: boolean;
  logger?: Logger;
  clock?: Clock;
}

/** Infrastructure singletons shared by every request/job (docs/backend/cross-cutting.md §1). */
export interface Cradle {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  clock: Clock;
  pool: pg.Pool;
  db: Database;
  replicaDb: Database;
  redis: Redis | undefined;
  orgId: string;
  container: AwilixContainer;
  [key: string]: unknown;
}

function devKey(name: string, logger: Logger): Buffer {
  logger.warn(`${name} not set: using a deterministic DEVELOPMENT key (never in production)`);
  return createHash('sha256').update(`school-dev-${name}`).digest();
}

/**
 * Composition root. Builds pools, Redis, crypto, queues and lets every module register itself.
 * Lifetimes: singletons for infrastructure; SCOPED (per request/job) for ctx, uow, repositories and use cases.
 */
export async function buildContainer(
  config: AppConfig,
  modules: ModuleDefinition[],
  options: ContainerOptions,
): Promise<AwilixContainer<Cradle>> {
  const logger = options.logger ?? createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });

  const dbUrl = options.role === 'worker' ? (config.DATABASE_WORKER_URL ?? config.DATABASE_URL) : config.DATABASE_URL;
  const pool = createPool({
    connectionString: dbUrl,
    max: config.DB_POOL_MAX,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
    applicationName: `school-${options.role}`,
  });
  const replicaPool = config.DATABASE_REPLICA_URL
    ? createPool({
        connectionString: config.DATABASE_REPLICA_URL,
        max: config.DB_POOL_MAX,
        statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
        applicationName: `school-${options.role}-ro`,
      })
    : pool;
  const db = createDatabase(pool);
  const replicaDb = replicaPool === pool ? db : createDatabase(replicaPool);

  // single organisation per deployment; core.organisation is readable without RLS context
  const org = await pool.query<{ id: string }>('SELECT id FROM core.organisation WHERE code = $1', [config.ORG_CODE]);
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new Error(`Organisation ${config.ORG_CODE} not found (run db seeds)`);

  const redis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false })
    : undefined;
  if (!redis) logger.warn('REDIS_URL not set: in-memory cache/rate limits and inline jobs (single process only)');

  const { service: tokens, ephemeral } = await TokenService.create({
    privateKeyPem: config.JWT_PRIVATE_KEY,
    publicKeysPem: config.JWT_PUBLIC_KEYS,
    kid: config.JWT_KID,
    issuer: config.JWT_ISSUER,
    accessTtlSec: config.ACCESS_TOKEN_TTL_SEC,
  });
  if (ephemeral) logger.warn('JWT keys not set: generated an ephemeral key pair (tokens die on restart)');

  const fieldKey = config.FIELD_KEY_V1 ? Buffer.from(config.FIELD_KEY_V1, 'base64') : devKey('FIELD_KEY_V1', logger);
  const bidxKey = config.BLIND_INDEX_KEY
    ? Buffer.from(config.BLIND_INDEX_KEY, 'base64')
    : devKey('BLIND_INDEX_KEY', logger);

  const storageDriver =
    config.STORAGE_DRIVER ?? (config.NODE_ENV === 'production' || config.S3_ENDPOINT ? 's3' : 'local');
  if (storageDriver === 'local') logger.warn(`Files are stored on local disk (${config.LOCAL_STORAGE_DIR}); dev only`);

  const queues = new Map<string, Queue>();
  const queueFor = (name: string): Queue => {
    if (!redis) throw new Error('Queues need REDIS_URL');
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: redis, prefix: 'sms' });
      queues.set(name, q);
    }
    return q;
  };

  const jobs = new JobRegistry();
  const subscriptions = new SubscriptionRegistry();
  const scopeResolvers = new ScopeResolverRegistry();

  container.register({
    container: asValue(container),
    config: asValue(config),
    logger: asValue(logger),
    metrics: asValue(new Metrics(config.NODE_ENV !== 'test')),
    clock: asValue(options.clock ?? new SystemClock()),
    pool: asValue(pool),
    replicaPool: asValue(replicaPool),
    db: asValue(db),
    replicaDb: asValue(replicaDb),
    redis: asValue(redis),
    orgId: asValue(orgId),
    queueFor: asValue(queueFor),
    queues: asValue(queues),
    cache: asValue(redis ? new RedisCache(redis) : new MemoryCache()),
    limiters: asValue(new RateLimiterFactory(redis)),
    tokens: asValue(tokens),
    passwordHasher: asValue(new PasswordHasher()),
    fieldCipher: asValue(new AesGcmFieldCipher({ v1: fieldKey }, 'v1')),
    blindIndexer: asValue(new HmacBlindIndexer(bidxKey)),
    fileStorage: asValue(
      storageDriver === 'local'
        ? new LocalDiskFileStorage(
            config.LOCAL_STORAGE_DIR,
            createHmac('sha256', bidxKey).update('local-file-storage').digest(),
          )
        : new S3FileStorage({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
          }),
    ),
    idempotency: asValue(new IdempotencyStore(db)),
    jobs: asValue(jobs),
    subscriptions: asValue(subscriptions),
    scopeResolverRegistry: asValue(scopeResolvers),
    jobRunner: asClass(JobRunner, { lifetime: Lifetime.SINGLETON }),
    subscriptionRunner: asClass(SubscriptionRunner, { lifetime: Lifetime.SINGLETON }),
    eventBus: asFunction(
      (c: Cradle): EventBus =>
        redis
          ? new BullMqEventBus(queueFor(EVENTS_QUEUE))
          : new InlineEventBus(() => c.container.resolve<SubscriptionRunner>('subscriptionRunner'), c.logger),
      { lifetime: Lifetime.SINGLETON },
    ),
    jobQueue: asFunction(
      (c: Cradle) =>
        redis
          ? new BullMqJobQueue(queueFor)
          : new InlineJobQueue(
              () => c.container.resolve<JobRunner>('jobRunner'),
              c.logger,
              options.awaitInlineJobs ?? false,
            ),
      { lifetime: Lifetime.SINGLETON },
    ),

    // ---- per request / per job ----
    uow: asClass(UnitOfWork, { lifetime: Lifetime.SCOPED }),
    outbox: asClass(OutboxWriter, { lifetime: Lifetime.SCOPED }),
    numbers: asClass(PgNumberAllocator, { lifetime: Lifetime.SCOPED }),
    auditLog: asClass(DbAuditLog, { lifetime: Lifetime.SCOPED }),
    scopePolicy: asClass(ScopePolicy, { lifetime: Lifetime.SCOPED }),
  });

  const mc = { config, jobs, subscriptions, scopeResolvers };
  // Modules share one container: a name registered twice would silently replace another module's class
  // (e.g. two `listLoans` use cases). Fail fast at boot instead.
  for (const m of modules) {
    const before = new Set(Object.keys(container.registrations));
    const register = container.register.bind(container);
    const added: string[] = [];
    (container as { register: unknown }).register = ((nameOrMap: string | Record<string, unknown>, value?: unknown) => {
      const names = typeof nameOrMap === 'string' ? [nameOrMap] : Object.keys(nameOrMap);
      added.push(...names);
      return typeof nameOrMap === 'string' ? register(nameOrMap, value as never) : register(nameOrMap as never);
    }) as typeof container.register;
    try {
      m.register(container, mc);
    } finally {
      (container as { register: unknown }).register = register;
    }
    const clash = added.filter((n) => before.has(n));
    if (clash.length)
      throw new Error(`Module ${m.name} re-registers ${clash.join(', ')} (already registered by another module)`);
  }

  container.register({
    scopeResolvers: asFunction((c: Cradle) => scopeResolvers.names.map((n) => c[n] as ScopeResolver), {
      lifetime: Lifetime.SCOPED,
    }),
  });

  return container;
}

/** Closes pools, Redis and queues (graceful shutdown). */
export async function disposeContainer(container: AwilixContainer<Cradle>): Promise<void> {
  const { pool, redis } = container.cradle;
  const replicaPool = container.resolve<pg.Pool>('replicaPool');
  const queues = container.resolve<Map<string, Queue>>('queues');
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  await Promise.allSettled([pool.end(), replicaPool !== pool ? replicaPool.end() : Promise.resolve()]);
  if (redis) await redis.quit().catch(() => redis.disconnect());
}
