import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * Single active scheduler/outbox-relay across worker replicas: Redis lock with TTL, renewed while held.
 * If the leader dies, another worker takes over after `ttlMs`.
 */
export class LeaderElection {
  private readonly id = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private leader = false;

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly onElected: () => Promise<void>,
    private readonly onDemoted: () => Promise<void>,
    private readonly key = 'lock:leader',
    private readonly ttlMs = 15_000,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.ttlMs / 3);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.leader) {
      // release only if we still own it
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        this.key,
        this.id,
      );
      this.leader = false;
      await this.onDemoted();
    }
  }

  private async tick(): Promise<void> {
    try {
      if (this.leader) {
        const renewed = await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
          1,
          this.key,
          this.id,
          String(this.ttlMs),
        );
        if (renewed !== 1) {
          this.leader = false;
          this.logger.warn('lost leadership');
          await this.onDemoted();
        }
        return;
      }
      const acquired = await this.redis.set(this.key, this.id, 'PX', this.ttlMs, 'NX');
      if (acquired === 'OK') {
        this.leader = true;
        this.logger.info({ id: this.id }, 'elected leader (scheduler + outbox relay)');
        await this.onElected();
      }
    } catch (err) {
      this.logger.error({ err }, 'leader election error');
    }
  }
}
