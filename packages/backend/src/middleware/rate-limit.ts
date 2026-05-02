import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { type Env, getEnv } from '@/config/env.js';
import { container, TOKENS } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { withRateLimitRedisTimeout } from '@/lib/rate-limit-timeout.js';
import { getClientIpForContext } from '@/lib/request-ip.js';
import { AppError } from '@/middleware/error-handler.js';
import type { RedisClient } from '@/services/cache.service.js';
import type { AppEnv } from '@/types.js';

const logger = createChildLogger('RateLimit');
const RATE_LIMIT_PIPELINE_RESULT_COUNT = 4;

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

type RateLimitSelector = (env: Env) => number;

function rateLimitUnavailable(error?: unknown): AppError {
  logger.warn('Rate limiter unavailable', {
    error: error instanceof Error ? error.message : error == null ? undefined : String(error),
  });
  return new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Gateway is temporarily unavailable');
}

function getPipelineCount(results: unknown): number {
  if (!Array.isArray(results)) {
    throw rateLimitUnavailable(new Error('Redis pipeline returned no results'));
  }
  if (results.length !== RATE_LIMIT_PIPELINE_RESULT_COUNT) {
    throw rateLimitUnavailable(new Error('Redis pipeline returned incomplete results'));
  }

  for (const result of results) {
    if (!Array.isArray(result) || result.length < 2) {
      throw rateLimitUnavailable(new Error('Redis pipeline returned malformed result'));
    }
    const [error] = result;
    if (error) {
      throw rateLimitUnavailable(error);
    }
  }

  const count = results[1]?.[1];
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw rateLimitUnavailable(new Error('Redis pipeline returned invalid request count'));
  }

  return count;
}

export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler<AppEnv> {
  const { windowMs, maxRequests, keyPrefix = 'ratelimit' } = config;

  return async (c, next) => {
    const clientIp = (await getClientIpForContext(c)) || 'unknown';

    const key = `${keyPrefix}:${clientIp}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const redis = container.resolve<RedisClient>(TOKENS.RedisClient);
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, `${now}-${randomUUID()}`);
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      const results = await withRateLimitRedisTimeout(pipeline.exec());
      const requestCount = getPipelineCount(results);

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
      throw rateLimitUnavailable(error);
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
