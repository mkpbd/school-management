import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { RateLimitError } from '../../domain/errors.js';

export interface RateLimitRule {
  /** limiter name, part of the Redis key */
  name: string;
  points: number;
  durationSec: number;
  /** optional lock-out after the limit is reached */
  blockDurationSec?: number;
}

/** Creates (and memoises) Redis-backed limiters, or in-memory ones when Redis is not configured. */
export class RateLimiterFactory {
  private readonly limiters = new Map<string, RateLimiterAbstract>();

  constructor(private readonly redis: Redis | undefined) {}

  get(rule: RateLimitRule): RateLimiterAbstract {
    const key = `${rule.name}:${rule.points}:${rule.durationSec}`;
    let limiter = this.limiters.get(key);
    if (!limiter) {
      const opts = {
        keyPrefix: `rl:${rule.name}`,
        points: rule.points,
        duration: rule.durationSec,
        blockDuration: rule.blockDurationSec ?? 0,
      };
      limiter = this.redis ? new RateLimiterRedis({ storeClient: this.redis, ...opts }) : new RateLimiterMemory(opts);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  /** Consumes one point or throws RateLimitError (429 with Retry-After). */
  async consume(rule: RateLimitRule, subject: string, points = 1): Promise<void> {
    try {
      await this.get(rule).consume(subject, points);
    } catch (err) {
      if (err instanceof RateLimiterRes) throw new RateLimitError(Math.max(1, Math.ceil(err.msBeforeNext / 1000)));
      throw err;
    }
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.get(rule).delete(subject);
  }
}

/** Shared rules (docs/backend/cross-cutting.md §4.3). */
export const RateLimits = {
  global: { name: 'global', points: 600, durationSec: 60 },
  login: { name: 'login', points: 5, durationSec: 15 * 60, blockDurationSec: 15 * 60 },
  otpRequestPhone: { name: 'otp-phone', points: 3, durationSec: 15 * 60 },
  otpRequestIp: { name: 'otp-ip', points: 10, durationSec: 60 * 60 },
  payments: { name: 'payments', points: 10, durationSec: 60 },
} satisfies Record<string, RateLimitRule>;
