import type { MiddlewareHandler } from 'hono';
import { getEnv } from '@/config/env.js';
import { container, TOKENS } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import type { RedisClient } from '@/services/cache.service.js';
import type { AppEnv } from '@/types.js';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler<AppEnv> {
  const { windowMs, maxRequests, keyPrefix = 'ratelimit' } = config;

  return async (c, next) => {
    const redis = container.resolve<RedisClient>(TOKENS.RedisClient);

    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';

    const key = `${keyPrefix}:${clientIp}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();

      if (!results) {
        await next();
        return;
      }

      const requestCount = (results[1]?.[1] as number) || 0;

      c.res.headers.set('X-RateLimit-Limit', String(maxRequests));
      c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - requestCount - 1)));
      c.res.headers.set('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

      if (requestCount >= maxRequests) {
        throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later');
      }

      await next();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      await next();
    }
  };
}

export const rateLimitMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = getEnv();
  const limiter = createRateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  });
  return limiter(c, next);
};
