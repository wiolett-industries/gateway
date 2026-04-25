import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { container, TOKENS } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AppEnv } from '@/types.js';
import { createRateLimiter } from './rate-limit.js';

interface Entry {
  score: number;
  member: string;
}

class MemoryRedis {
  readonly sets = new Map<string, Entry[]>();

  pipeline() {
    return new MemoryPipeline(this);
  }
}

class MemoryPipeline {
  private readonly ops: Array<() => number> = [];

  constructor(private readonly redis: MemoryRedis) {}

  zremrangebyscore(key: string, min: number, max: number) {
    this.ops.push(() => {
      const entries = this.redis.sets.get(key) ?? [];
      const remaining = entries.filter((entry) => entry.score < min || entry.score > max);
      this.redis.sets.set(key, remaining);
      return entries.length - remaining.length;
    });
    return this;
  }

  zcard(key: string) {
    this.ops.push(() => this.redis.sets.get(key)?.length ?? 0);
    return this;
  }

  zadd(key: string, score: number, member: string) {
    this.ops.push(() => {
      const entries = this.redis.sets.get(key) ?? [];
      entries.push({ score, member });
      this.redis.sets.set(key, entries);
      return 1;
    });
    return this;
  }

  expire() {
    this.ops.push(() => 1);
    return this;
  }

  async exec() {
    return this.ops.map((op) => [null, op()] as [null, number]);
  }
}

function registerRedis(redis = new MemoryRedis()) {
  container.registerInstance(TOKENS.RedisClient, redis as any);
  return redis;
}

function createTestApp() {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ code: error.code, message: error.message }, error.statusCode as 400);
    }
    throw error;
  });
  return app;
}

afterEach(() => {
  container.reset();
});

describe('createRateLimiter', () => {
  it('rejects requests after the configured sliding-window limit', async () => {
    registerRedis();
    const app = createTestApp();
    app.use('*', createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'test:limit' }));
    app.get('/', (c) => c.text('ok'));

    expect((await app.request('/', { headers: { 'x-real-ip': '192.0.2.10' } })).status).toBe(200);
    const second = await app.request('/', { headers: { 'x-real-ip': '192.0.2.10' } });
    expect(second.status).toBe(200);
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');

    const limited = await app.request('/', { headers: { 'x-real-ip': '192.0.2.10' } });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('keeps global and route-specific buckets independent', async () => {
    registerRedis();
    const app = createTestApp();
    app.use('/api/*', createRateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'test:global' }));
    app.use('/api/auth/*', createRateLimiter({ windowMs: 60_000, maxRequests: 1, keyPrefix: 'test:auth' }));
    app.get('/api/auth/login', (c) => c.text('auth'));
    app.get('/api/other', (c) => c.text('other'));

    const firstAuth = await app.request('/api/auth/login', { headers: { 'x-real-ip': '192.0.2.20' } });
    expect(firstAuth.status).toBe(200);
    expect(firstAuth.headers.get('X-RateLimit-Limit')).toBe('1');

    expect((await app.request('/api/auth/login', { headers: { 'x-real-ip': '192.0.2.20' } })).status).toBe(429);
    expect((await app.request('/api/other', { headers: { 'x-real-ip': '192.0.2.20' } })).status).toBe(200);
  });
});
