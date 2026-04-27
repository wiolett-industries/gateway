import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  CreateLoggingEnvironmentSchema,
  CreateLoggingSchemaSchema,
  CreateLoggingTokenSchema,
  LoggingBatchSchema,
  LoggingFacetsQuerySchema,
  LoggingSearchSchema,
  UpdateLoggingEnvironmentSchema,
  UpdateLoggingSchemaSchema,
} from './logging.schemas.js';
import { LoggingEnvironmentService } from './logging-environment.service.js';
import { LoggingFeatureService } from './logging-feature.service.js';
import { LoggingIngestService } from './logging-ingest.service.js';
import { loggingIngestAuthMiddleware } from './logging-ingest-auth.middleware.js';
import { LoggingRateLimitService } from './logging-rate-limit.service.js';
import { LoggingSchemaService } from './logging-schema.service.js';
import { LoggingSearchService } from './logging-search.service.js';
import { LoggingTokenService } from './logging-token.service.js';

export const loggingRoutes = new OpenAPIHono<AppEnv>();

loggingRoutes.get('/status', (c) => {
  const feature = container.resolve(LoggingFeatureService);
  return c.json({ data: feature.getStatus() });
});

loggingRoutes.use('*', async (_c, next) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireEnabled();
  await next();
});

loggingRoutes.post('/ingest', loggingIngestAuthMiddleware, async (c) => {
  const body = await c.req.json();
  return handleIngest(c, body, [body]);
});

loggingRoutes.post('/ingest/batch', loggingIngestAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const parsed = LoggingBatchSchema.parse(body);
  return handleIngest(c, body, parsed.logs);
});

loggingRoutes.use('*', authMiddleware);

loggingRoutes.get('/environments', requireLoggingScope('logs:environments:list'), async (c) => {
  const service = container.resolve(LoggingEnvironmentService);
  const data = await service.list({ search: c.req.query('search') });
  return c.json({ data });
});

loggingRoutes.post('/environments', requireLoggingScope('logs:environments:create'), async (c) => {
  const service = container.resolve(LoggingEnvironmentService);
  const user = c.get('user')!;
  const input = CreateLoggingEnvironmentSchema.parse(await c.req.json());
  const data = await service.create(input, user.id);
  return c.json({ data }, 201);
});

loggingRoutes.get('/environments/:id', requireLoggingResourceScope('logs:environments:view'), async (c) => {
  const service = container.resolve(LoggingEnvironmentService);
  const data = await service.get(c.req.param('id'));
  return c.json({ data });
});

loggingRoutes.put('/environments/:id', requireLoggingResourceScope('logs:environments:edit'), async (c) => {
  const service = container.resolve(LoggingEnvironmentService);
  const user = c.get('user')!;
  const input = UpdateLoggingEnvironmentSchema.parse(await c.req.json());
  const data = await service.update(c.req.param('id'), input, user.id);
  return c.json({ data });
});

loggingRoutes.delete('/environments/:id', requireLoggingResourceScope('logs:environments:delete'), async (c) => {
  const service = container.resolve(LoggingEnvironmentService);
  const user = c.get('user')!;
  await service.delete(c.req.param('id'), user.id);
  return c.body(null, 204);
});

loggingRoutes.get('/schemas', requireLoggingScope('logs:environments:list'), async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const data = await service.list({ search: c.req.query('search') });
  return c.json({ data });
});

loggingRoutes.post('/schemas', requireLoggingScope('logs:manage'), async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const user = c.get('user')!;
  const input = CreateLoggingSchemaSchema.parse(await c.req.json());
  const data = await service.create(input, user.id);
  return c.json({ data }, 201);
});

loggingRoutes.get('/schemas/:schemaId', requireLoggingScope('logs:environments:view'), async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const data = await service.get(c.req.param('schemaId'));
  return c.json({ data });
});

loggingRoutes.put('/schemas/:schemaId', requireLoggingScope('logs:manage'), async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const user = c.get('user')!;
  const input = UpdateLoggingSchemaSchema.parse(await c.req.json());
  const data = await service.update(c.req.param('schemaId'), input, user.id);
  return c.json({ data });
});

loggingRoutes.delete('/schemas/:schemaId', requireLoggingScope('logs:manage'), async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const user = c.get('user')!;
  await service.delete(c.req.param('schemaId'), user.id);
  return c.body(null, 204);
});

loggingRoutes.get('/environments/:id/tokens', requireLoggingResourceScope('logs:tokens:list'), async (c) => {
  const service = container.resolve(LoggingTokenService);
  const data = await service.list(c.req.param('id'));
  return c.json({ data });
});

loggingRoutes.post('/environments/:id/tokens', requireLoggingResourceScope('logs:tokens:create'), async (c) => {
  const service = container.resolve(LoggingTokenService);
  const user = c.get('user')!;
  const input = CreateLoggingTokenSchema.parse(await c.req.json());
  const data = await service.create(c.req.param('id'), input, user.id);
  return c.json({ data }, 201);
});

loggingRoutes.delete(
  '/environments/:id/tokens/:tokenId',
  requireLoggingResourceScope('logs:tokens:delete'),
  async (c) => {
    const service = container.resolve(LoggingTokenService);
    const user = c.get('user')!;
    await service.delete(c.req.param('id'), c.req.param('tokenId'), user.id);
    return c.body(null, 204);
  }
);

loggingRoutes.post('/environments/:id/search', requireLoggingResourceScope('logs:read'), async (c) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireAvailableForStorage();
  const service = container.resolve(LoggingSearchService);
  const input = LoggingSearchSchema.parse(await c.req.json());
  const data = await service.search(c.req.param('id'), input as any);
  return c.json(data);
});

loggingRoutes.get('/environments/:id/facets', requireLoggingResourceScope('logs:read'), async (c) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireAvailableForStorage();
  const service = container.resolve(LoggingSearchService);
  const input = LoggingFacetsQuerySchema.parse(c.req.query());
  const data = await service.facets(c.req.param('id'), input);
  return c.json({ data });
});

async function handleIngest(c: any, body: unknown, logs: unknown[]) {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireAvailableForStorage();
  const ingestContext = c.get('loggingIngest');
  if (!ingestContext) throw new AppError(401, 'LOGGING_AUTH_REQUIRED', 'Logging ingest token required');
  const rateLimit = container.resolve(LoggingRateLimitService);
  await rateLimit.check({
    tokenId: ingestContext.tokenId,
    environmentId: ingestContext.environmentId,
    events: logs.length,
    environmentRequestLimit: ingestContext.environment.rateLimitRequestsPerWindow,
    environmentEventLimit: ingestContext.environment.rateLimitEventsPerWindow,
  });
  const service = container.resolve(LoggingIngestService);
  const data = await service.ingest({
    body,
    contentLength: c.req.header('Content-Length'),
    logs,
    environment: ingestContext.environment,
  });
  return c.json(data);
}

function requireLoggingScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const scopes = c.get('effectiveScopes') ?? [];
    if (!TokensService.hasScope(scopes, scope) && !TokensService.hasScope(scopes, 'logs:manage')) {
      throw new AppError(403, 'FORBIDDEN', `Missing required scope: ${scope}`);
    }
    await next();
  };
}

function requireLoggingResourceScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const id = c.req.param('id');
    const scopes = c.get('effectiveScopes') ?? [];
    if (
      !TokensService.hasScope(scopes, `${scope}:${id}`) &&
      !TokensService.hasScope(scopes, scope) &&
      !TokensService.hasScope(scopes, 'logs:manage')
    ) {
      throw new AppError(403, 'FORBIDDEN', `Missing required scope: ${scope}:${id}`);
    }
    await next();
  };
}
