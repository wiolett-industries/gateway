import type { MiddlewareHandler } from 'hono';
import { type Env, getEnv } from '@/config/env.js';
import { container, TOKENS } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import type { RedisClient } from '@/services/cache.service.js';
import type { AppEnv } from '@/types.js';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

type RateLimitSelector = (env: Env) => number;

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

function createEnvRateLimiter(keyPrefix: string, maxRequests: RateLimitSelector): MiddlewareHandler<AppEnv> {
  let cachedLimiter: MiddlewareHandler<AppEnv> | null = null;

  return async (c, next) => {
    if (!cachedLimiter) {
      const env = getEnv();
      cachedLimiter = createRateLimiter({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        maxRequests: maxRequests(env),
        keyPrefix,
      });
    }
    return cachedLimiter(c, next);
  };
}

export const rateLimitMiddleware = createEnvRateLimiter('ratelimit:api', (env) => env.RATE_LIMIT_MAX_REQUESTS);

export const authRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:auth',
  (env) => env.RATE_LIMIT_AUTH_MAX_REQUESTS
);

export const authLoginRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:auth:login',
  (env) => env.RATE_LIMIT_AUTH_LOGIN_MAX_REQUESTS
);

export const authCallbackRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:auth:callback',
  (env) => env.RATE_LIMIT_AUTH_CALLBACK_MAX_REQUESTS
);

export const setupRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:setup',
  (env) => env.RATE_LIMIT_SETUP_MAX_REQUESTS
);

export const publicStatusRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:public:status-page',
  (env) => env.RATE_LIMIT_PUBLIC_STATUS_MAX_REQUESTS
);

export const publicWebhookRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:public:webhook',
  (env) => env.RATE_LIMIT_PUBLIC_WEBHOOK_MAX_REQUESTS
);

export const pkiRateLimitMiddleware = createEnvRateLimiter('ratelimit:pki', (env) => env.RATE_LIMIT_PKI_MAX_REQUESTS);

export const streamRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:stream',
  (env) => env.RATE_LIMIT_STREAM_MAX_REQUESTS
);

export const aiWebSocketRateLimitMiddleware = createEnvRateLimiter(
  'ratelimit:ai:ws',
  (env) => env.RATE_LIMIT_AI_WS_MAX_REQUESTS
);
