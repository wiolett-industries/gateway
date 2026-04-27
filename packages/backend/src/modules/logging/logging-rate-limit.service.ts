import type { Env } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';
import type { RedisClient } from '@/services/cache.service.js';

type RateScope = 'global' | 'token' | 'environment';

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
    const count = await this.redis.incrby(key, amount);
    if (count === amount) await this.redis.expire(key, windowSeconds);
    if (count > limit) {
      const ttl = await this.redis.ttl(key);
      throw new AppError(429, 'LOGGING_RATE_LIMIT_EXCEEDED', 'Logging ingest rate limit exceeded', {
        scope,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      });
    }
  }
}
