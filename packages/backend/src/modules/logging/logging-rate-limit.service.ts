import type { Env } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
import { withRateLimitRedisTimeout } from '@/lib/rate-limit-timeout.js';
import { AppError } from '@/middleware/error-handler.js';
import type { RedisClient } from '@/services/cache.service.js';

type RateScope = 'global' | 'token' | 'environment';

const logger = createChildLogger('LoggingRateLimit');

function rateLimitUnavailable(error?: unknown): AppError {
  logger.warn('Logging rate limiter unavailable', {
    error: error instanceof Error ? error.message : error == null ? undefined : String(error),
  });
  return new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Gateway is temporarily unavailable');
}

export class LoggingRateLimitService {
  constructor(
    private readonly redis: RedisClient,
    private readonly env: Env
  ) {}

  async check(params: {
    tokenId: string;
    environmentId: string;
    events: number;
    environmentRequestLimit: number | null;
    environmentEventLimit: number | null;
  }): Promise<void> {
    const windowSeconds = this.env.LOGGING_RATE_LIMIT_WINDOW_SECONDS;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    await this.hit(
      `logging:rl:${bucket}:global:requests`,
      1,
      this.env.LOGGING_GLOBAL_REQUESTS_PER_WINDOW,
      windowSeconds,
      'global'
    );
    await this.hit(
      `logging:rl:${bucket}:global:events`,
      params.events,
      this.env.LOGGING_GLOBAL_EVENTS_PER_WINDOW,
      windowSeconds,
      'global'
    );
    await this.hit(
      `logging:rl:${bucket}:token:${params.tokenId}:requests`,
      1,
      this.env.LOGGING_TOKEN_REQUESTS_PER_WINDOW,
      windowSeconds,
      'token'
    );
    await this.hit(
      `logging:rl:${bucket}:token:${params.tokenId}:events`,
      params.events,
      this.env.LOGGING_TOKEN_EVENTS_PER_WINDOW,
      windowSeconds,
      'token'
    );
    await this.hit(
      `logging:rl:${bucket}:env:${params.environmentId}:requests`,
      1,
      params.environmentRequestLimit ?? this.env.LOGGING_TOKEN_REQUESTS_PER_WINDOW,
      windowSeconds,
      'environment'
    );
    await this.hit(
      `logging:rl:${bucket}:env:${params.environmentId}:events`,
      params.events,
      params.environmentEventLimit ?? this.env.LOGGING_TOKEN_EVENTS_PER_WINDOW,
      windowSeconds,
      'environment'
    );
  }

  private async hit(
    key: string,
    amount: number,
    limit: number,
    windowSeconds: number,
    scope: RateScope
  ): Promise<void> {
    let count: number;
    try {
      count = await withRateLimitRedisTimeout(this.redis.incrby(key, amount));
      if (typeof count !== 'number' || !Number.isFinite(count)) {
        throw new Error('Redis returned invalid logging rate-limit count');
      }
      if (count === amount) {
        const expireResult = await withRateLimitRedisTimeout(this.redis.expire(key, windowSeconds));
        if (expireResult !== 1) {
          throw new Error('Redis failed to set logging rate-limit expiry');
        }
      }
    } catch (error) {
      throw rateLimitUnavailable(error);
    }

    if (count > limit) {
      let ttl: number;
      try {
        ttl = await withRateLimitRedisTimeout(this.redis.ttl(key));
        if (typeof ttl !== 'number' || !Number.isFinite(ttl)) {
          throw new Error('Redis returned invalid logging rate-limit TTL');
        }
      } catch (error) {
        throw rateLimitUnavailable(error);
      }
      throw new AppError(429, 'LOGGING_RATE_LIMIT_EXCEEDED', 'Logging ingest rate limit exceeded', {
        scope,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      });
    }
  }
}
