import type { Redis } from 'ioredis';
import type { Cache } from '../../application/ports.js';

/** Cache keys in one place (docs/backend/cross-cutting.md §16). Nothing financial is ever cached. */
export const CacheKeys = {
  grants: (userId: string, authzVersion: number) => `authz:${userId}:${authzVersion}`,
  scopeSet: (userId: string, kind: string) => `scope:${userId}:${kind}`,
  settings: (orgId: string, campusId: string | null) => `settings:${orgId}:${campusId ?? 'org'}`,
  reference: (orgId: string, name: string) => `ref:${orgId}:${name}`,
  orgByCode: (code: string) => `org:code:${code}`,
};

export class RedisCache implements Cache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'c:',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), 'EX', ttlSec);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map((k) => this.prefix + k));
  }

  async wrap<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    await this.set(key, value, ttlSec);
    return value;
  }
}

/** Process-local cache for development and tests (single instance only). */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return JSON.parse(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    this.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSec * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    keys.forEach((k) => this.store.delete(k));
  }

  async wrap<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    await this.set(key, value, ttlSec);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
