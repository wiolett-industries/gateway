import { describe, expect, it, vi } from 'vitest';
import type { Env } from '@/config/env.js';
import { RATE_LIMIT_REDIS_TIMEOUT_MS } from '@/lib/rate-limit-timeout.js';
import { AppError } from '@/middleware/error-handler.js';
import { LoggingRateLimitService } from './logging-rate-limit.service.js';

const ENV = {
  LOGGING_RATE_LIMIT_WINDOW_SECONDS: 60,
  LOGGING_GLOBAL_REQUESTS_PER_WINDOW: 10,
  LOGGING_GLOBAL_EVENTS_PER_WINDOW: 100,
  LOGGING_TOKEN_REQUESTS_PER_WINDOW: 10,
  LOGGING_TOKEN_EVENTS_PER_WINDOW: 100,
} as Env;

function createRedis(overrides: Record<string, unknown> = {}) {
  return {
    incrby: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
    ...overrides,
  } as any;
}

const CHECK_PARAMS = {
  tokenId: 'token-1',
  environmentId: 'env-1',
  events: 2,
  environmentRequestLimit: null,
  environmentEventLimit: null,
};

describe('LoggingRateLimitService', () => {
  it('allows logging ingest within configured limits', async () => {
    const redis = createRedis();
    const service = new LoggingRateLimitService(redis, ENV);

    await expect(service.check(CHECK_PARAMS)).resolves.toBeUndefined();

    expect(redis.incrby).toHaveBeenCalledTimes(6);
  });

  it('rejects logging ingest when a limit is exceeded', async () => {
    const redis = createRedis({
      incrby: vi.fn().mockResolvedValueOnce(11),
    });
    const service = new LoggingRateLimitService(redis, ENV);

    await expect(service.check(CHECK_PARAMS)).rejects.toMatchObject({
      statusCode: 429,
      code: 'LOGGING_RATE_LIMIT_EXCEEDED',
    });
  });

  it('fails closed when Redis increment fails', async () => {
    const redis = createRedis({
      incrby: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const service = new LoggingRateLimitService(redis, ENV);

    await expect(service.check(CHECK_PARAMS)).rejects.toMatchObject({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
      message: 'Gateway is temporarily unavailable',
    });
  });

  it('fails closed when Redis expiry cannot be set', async () => {
    const redis = createRedis({
      expire: vi.fn().mockResolvedValue(0),
    });
    const service = new LoggingRateLimitService(redis, ENV);

    await expect(service.check(CHECK_PARAMS)).rejects.toMatchObject({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('fails closed when Redis TTL lookup fails for an exceeded limit', async () => {
    const redis = createRedis({
      incrby: vi.fn().mockResolvedValueOnce(11),
      ttl: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const service = new LoggingRateLimitService(redis, ENV);

    const error = await service.check(CHECK_PARAMS).catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('fails closed when Redis increment stalls', async () => {
    vi.useFakeTimers();
    try {
      const redis = createRedis({
        incrby: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      });
      const service = new LoggingRateLimitService(redis, ENV);

      const assertion = expect(service.check(CHECK_PARAMS)).rejects.toMatchObject({
        statusCode: 503,
        code: 'RATE_LIMIT_UNAVAILABLE',
      });
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_REDIS_TIMEOUT_MS);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
