import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { extractBaseScope } from '@/lib/scopes.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  createLoggingEnvironmentRoute,
  createLoggingSchemaRoute,
  createLoggingTokenRoute,
  deleteLoggingEnvironmentRoute,
  deleteLoggingSchemaRoute,
  deleteLoggingTokenRoute,
  getLoggingEnvironmentRoute,
  getLoggingSchemaRoute,
  listLoggingEnvironmentsRoute,
  listLoggingSchemasRoute,
  listLoggingTokensRoute,
  loggingBatchIngestRoute,
  loggingFacetsRoute,
  loggingIngestRoute,
  loggingMetadataRoute,
  loggingStatusRoute,
  searchLogsRoute,
  updateLoggingEnvironmentRoute,
  updateLoggingSchemaRoute,
} from './logging.docs.js';
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
import { LoggingMetadataService } from './logging-metadata.service.js';
import { LoggingRateLimitService } from './logging-rate-limit.service.js';
import { LoggingSchemaService } from './logging-schema.service.js';
import { LoggingSearchService } from './logging-search.service.js';
import { LoggingTokenService } from './logging-token.service.js';

export const loggingRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

loggingRoutes.openapi(loggingStatusRoute, (c) => {
  const feature = container.resolve(LoggingFeatureService);
  return c.json({ data: feature.getStatus() });
});

loggingRoutes.use('*', async (_c, next) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireEnabled();
  await next();
});

loggingRoutes.openapi({ ...loggingIngestRoute, middleware: loggingIngestAuthMiddleware }, async (c) => {
  const body = await c.req.json();
  return handleIngest(c, body, [body]);
});

loggingRoutes.openapi({ ...loggingBatchIngestRoute, middleware: loggingIngestAuthMiddleware }, async (c) => {
  const body = await c.req.json();
  const parsed = LoggingBatchSchema.parse(body);
  return handleIngest(c, body, parsed.logs);
});

loggingRoutes.use('*', authMiddleware);

loggingRoutes.openapi(
  { ...listLoggingEnvironmentsRoute, middleware: requireLoggingEnvironmentListScope() },
  async (c) => {
    const service = container.resolve(LoggingEnvironmentService);
    const scopes = c.get('effectiveScopes') ?? [];
    const hasGlobalAccess =
      TokensService.hasScope(scopes, 'logs:environments:view') || TokensService.hasScope(scopes, 'logs:manage');
    const allowedIds = hasGlobalAccess ? undefined : [...resourceScopedIds(scopes, 'logs:environments:view')];
    const data = await service.list({ search: c.req.query('search'), allowedIds });
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...createLoggingEnvironmentRoute, middleware: requireLoggingScope('logs:environments:create') },
  async (c) => {
    const service = container.resolve(LoggingEnvironmentService);
    const user = c.get('user')!;
    const input = CreateLoggingEnvironmentSchema.parse(await c.req.json());
    const data = await service.create(input, user.id);
    return c.json({ data }, 201);
  }
);

loggingRoutes.openapi(
  { ...getLoggingEnvironmentRoute, middleware: requireLoggingResourceScope('logs:environments:view') },
  async (c) => {
    const service = container.resolve(LoggingEnvironmentService);
    const data = await service.get(c.req.param('id')!);
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...updateLoggingEnvironmentRoute, middleware: requireLoggingResourceScope('logs:environments:edit') },
  async (c) => {
    const service = container.resolve(LoggingEnvironmentService);
    const user = c.get('user')!;
    const input = UpdateLoggingEnvironmentSchema.parse(await c.req.json());
    const data = await service.update(c.req.param('id')!, input, user.id);
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...deleteLoggingEnvironmentRoute, middleware: requireLoggingResourceScope('logs:environments:delete') },
  async (c) => {
    const service = container.resolve(LoggingEnvironmentService);
    const user = c.get('user')!;
    await service.delete(c.req.param('id')!, user.id);
    return c.body(null, 204);
  }
);

loggingRoutes.openapi({ ...listLoggingSchemasRoute, middleware: requireLoggingSchemaListScope() }, async (c) => {
  const service = container.resolve(LoggingSchemaService);
  const scopes = c.get('effectiveScopes') ?? [];
  const data = await service.list({ search: c.req.query('search') });
  if (TokensService.hasScope(scopes, 'logs:schemas:view') || TokensService.hasScope(scopes, 'logs:manage')) {
    return c.json({ data });
  }
  const visibleIds = resourceScopedIds(scopes, 'logs:schemas:view');
  return c.json({ data: data.filter((schema) => visibleIds.has(schema.id)) });
});

loggingRoutes.openapi(
  { ...createLoggingSchemaRoute, middleware: requireLoggingScope('logs:schemas:create') },
  async (c) => {
    const service = container.resolve(LoggingSchemaService);
    const user = c.get('user')!;
    const input = CreateLoggingSchemaSchema.parse(await c.req.json());
    const data = await service.create(input, user.id);
    return c.json({ data }, 201);
  }
);

loggingRoutes.openapi(
  { ...getLoggingSchemaRoute, middleware: requireLoggingSchemaScope('logs:schemas:view') },
  async (c) => {
    const service = container.resolve(LoggingSchemaService);
    const data = await service.get(c.req.param('schemaId')!);
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...updateLoggingSchemaRoute, middleware: requireLoggingSchemaScope('logs:schemas:edit') },
  async (c) => {
    const service = container.resolve(LoggingSchemaService);
    const user = c.get('user')!;
    const input = UpdateLoggingSchemaSchema.parse(await c.req.json());
    const data = await service.update(c.req.param('schemaId')!, input, user.id);
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...deleteLoggingSchemaRoute, middleware: requireLoggingSchemaScope('logs:schemas:delete') },
  async (c) => {
    const service = container.resolve(LoggingSchemaService);
    const user = c.get('user')!;
    await service.delete(c.req.param('schemaId')!, user.id);
    return c.body(null, 204);
  }
);

loggingRoutes.openapi(
  { ...listLoggingTokensRoute, middleware: requireLoggingResourceScope('logs:tokens:view') },
  async (c) => {
    const service = container.resolve(LoggingTokenService);
    const data = await service.list(c.req.param('id')!);
    return c.json({ data });
  }
);

loggingRoutes.openapi(
  { ...createLoggingTokenRoute, middleware: requireLoggingResourceScope('logs:tokens:create') },
  async (c) => {
    const service = container.resolve(LoggingTokenService);
    const user = c.get('user')!;
    const input = CreateLoggingTokenSchema.parse(await c.req.json());
    const data = await service.create(c.req.param('id')!, input, user.id);
    return c.json({ data }, 201);
  }
);

loggingRoutes.openapi(
  { ...deleteLoggingTokenRoute, middleware: requireLoggingResourceScope('logs:tokens:delete') },
  async (c) => {
    const service = container.resolve(LoggingTokenService);
    const user = c.get('user')!;
    await service.delete(c.req.param('id')!, c.req.param('tokenId')!, user.id);
    return c.body(null, 204);
  }
);

loggingRoutes.openapi({ ...searchLogsRoute, middleware: requireLoggingResourceScope('logs:read') }, async (c) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireAvailableForStorage();
  const service = container.resolve(LoggingSearchService);
  const input = LoggingSearchSchema.parse(await c.req.json());
  const data = await service.search(c.req.param('id')!, input as any);
  return c.json(data);
});

loggingRoutes.openapi({ ...loggingFacetsRoute, middleware: requireLoggingResourceScope('logs:read') }, async (c) => {
  const feature = container.resolve(LoggingFeatureService);
  feature.requireAvailableForStorage();
  const service = container.resolve(LoggingSearchService);
  const input = LoggingFacetsQuerySchema.parse(c.req.query());
  const data = await service.facets(c.req.param('id')!, input);
  return c.json({ data });
});

loggingRoutes.openapi({ ...loggingMetadataRoute, middleware: requireLoggingResourceScope('logs:read') }, async (c) => {
  const service = container.resolve(LoggingMetadataService);
  const data = await service.get(c.req.param('id')!);
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

function resourceScopedIds(scopes: string[], scope: string): Set<string> {
  const ids = new Set<string>();
  for (const candidate of scopes) {
    const base = extractBaseScope(candidate);
    if (candidate === base) continue;
    const id = candidate.slice(base.length + 1);
    if (id && TokensService.hasScope([candidate], `${scope}:${id}`)) ids.add(id);
  }
  return ids;
}

function requireLoggingSchemaListScope() {
  return async (c: any, next: () => Promise<void>) => {
    const scopes = c.get('effectiveScopes') ?? [];
    if (
      !TokensService.hasScope(scopes, 'logs:schemas:view') &&
      !TokensService.hasScope(scopes, 'logs:manage') &&
      resourceScopedIds(scopes, 'logs:schemas:view').size === 0
    ) {
      throw new AppError(403, 'FORBIDDEN', 'Missing required scope: logs:schemas:view');
    }
    await next();
  };
}

function requireLoggingEnvironmentListScope() {
  return async (c: any, next: () => Promise<void>) => {
    const scopes = c.get('effectiveScopes') ?? [];
    if (
      !TokensService.hasScope(scopes, 'logs:environments:view') &&
      !TokensService.hasScope(scopes, 'logs:manage') &&
      resourceScopedIds(scopes, 'logs:environments:view').size === 0
    ) {
      throw new AppError(403, 'FORBIDDEN', 'Missing required scope: logs:environments:view');
    }
    await next();
  };
}

function requireLoggingSchemaScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const schemaId = c.req.param('schemaId')!;
    const scopes = c.get('effectiveScopes') ?? [];
    if (
      !TokensService.hasScope(scopes, `${scope}:${schemaId}`) &&
      !TokensService.hasScope(scopes, scope) &&
      !TokensService.hasScope(scopes, 'logs:manage')
    ) {
      throw new AppError(403, 'FORBIDDEN', `Missing required scope: ${scope}:${schemaId}`);
    }
    await next();
  };
}

function requireLoggingResourceScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const id = c.req.param('id')!;
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
