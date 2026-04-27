import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { container } from '@/container.js';
import type { AppEnv } from '@/types.js';
import { LoggingTokenService } from './logging-token.service.js';

export const loggingIngestAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Logging ingest token required' });
  }
  const rawToken = authHeader.slice(7).trim();
  const tokenService = container.resolve(LoggingTokenService);
  const result = await tokenService.validate(rawToken);
  if (!result) {
    throw new HTTPException(401, { message: 'Invalid or expired logging ingest token' });
  }
  c.set('loggingIngest', result);
  await next();
};
