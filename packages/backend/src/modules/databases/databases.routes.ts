import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware, requireScope, requireScopeForResource, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { AppError } from '@/middleware/error-handler.js';
import { hasScope } from '@/lib/permissions.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import { DatabaseMonitoringService } from './database-monitoring.service.js';
import {
  BrowsePostgresRowsQuerySchema,
  CreateDatabaseConnectionSchema,
  DatabaseListQuerySchema,
  ExecutePostgresSqlSchema,
  ExecuteRedisCommandSchema,
  PostgresObjectSchema,
  RedisExpireKeySchema,
  RedisGetKeyQuerySchema,
  RedisScanKeysQuerySchema,
  RedisSetKeySchema,
  UpdateDatabaseConnectionSchema,
} from './databases.schemas.js';
import { DatabaseConnectionService, inferPostgresIntent, inferRedisIntent } from './databases.service.js';

export const databaseRoutes = new OpenAPIHono<AppEnv>();

const DATABASE_ACCESS_SCOPE_BASES = [
  'databases:list',
  'databases:view',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
] as const;

function getListAccessibleDatabaseIds(scopes: string[]): string[] {
  const ids = new Set<string>();
  for (const scope of scopes) {
    const base = 'databases:list';
    if (scope.startsWith(`${base}:`)) {
      const id = scope.slice(base.length + 1);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function ensureQueryScope(c: any, databaseId: string, intent: 'read' | 'write' | 'admin') {
  const scopeSets =
    intent === 'read'
      ? ['databases:query:read', 'databases:query:write', 'databases:query:admin']
      : intent === 'write'
        ? ['databases:query:write', 'databases:query:admin']
        : ['databases:query:admin'];
  ensureAnyDatabaseScope(c, databaseId, scopeSets);
}

function ensureAnyDatabaseScope(c: any, databaseId: string, scopeBases: string[]) {
  const scopes = c.get('effectiveScopes') ?? [];
  const granted = scopeBases.some((base) => TokensService.hasScope(scopes, `${base}:${databaseId}`));
  if (!granted) {
    throw new AppError(403, 'FORBIDDEN', `Missing required scope for database ${databaseId}`);
  }
}

databaseRoutes.use('*', authMiddleware);
databaseRoutes.use('*', sessionOnly);

databaseRoutes.get('/', async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const scopes = c.get('effectiveScopes') ?? [];
  const hasGlobalAccess = hasScope(scopes, 'databases:list');
  const allowedIds = getListAccessibleDatabaseIds(scopes);
  if (!hasGlobalAccess && allowedIds.length === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Missing required database access scope');
  }
  const query = DatabaseListQuerySchema.parse(c.req.query());
  const data = await service.list(query, hasGlobalAccess ? undefined : { allowedIds });
  return c.json(data);
});

databaseRoutes.post('/', requireScope('databases:create'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const input = CreateDatabaseConnectionSchema.parse(await c.req.json());
  const data = await service.create(input, user.id);
  return c.json({ data }, 201);
});

databaseRoutes.get('/:id', requireScopeForResource('databases:view', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const data = await service.get(c.req.param('id'));
  return c.json({ data });
});

databaseRoutes.patch('/:id', requireScopeForResource('databases:edit', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const input = UpdateDatabaseConnectionSchema.parse(await c.req.json());
  const data = await service.update(c.req.param('id'), input, user.id);
  return c.json({ data });
});

databaseRoutes.delete('/:id', requireScopeForResource('databases:delete', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  await service.delete(c.req.param('id'), user.id);
  return c.json({ success: true });
});

databaseRoutes.post('/:id/test', requireScopeForResource('databases:edit', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const data = await service.testSavedConnection(c.req.param('id'), user.id);
  return c.json({ data });
});

databaseRoutes.get('/:id/reveal-credentials', requireScopeForResource('databases:credentials:reveal', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const data = await service.revealCredentials(c.req.param('id'));
  return c.json({ data });
});

databaseRoutes.get('/:id/monitoring/stream', requireScopeForResource('databases:view', 'id'), async (c) => {
  const databaseId = c.req.param('id');
  const monitoring = container.resolve(DatabaseMonitoringService);
  const connections = container.resolve(DatabaseConnectionService);

  return streamSSE(c, async (stream) => {
    monitoring.registerClient(databaseId);
    const [history, details] = await Promise.all([monitoring.getHistory(databaseId), connections.get(databaseId)]);
    await stream.writeSSE({
      data: JSON.stringify({
        connected: true,
        databaseId,
        history,
        healthHistory: details.healthHistory,
        healthStatus: details.healthStatus,
      }),
      event: 'connected',
    });
    await stream.sleep(0);

    const onSnapshot = (payload: { databaseId: string; snapshot: unknown }) => {
      if (payload.databaseId !== databaseId) return;
      stream.writeSSE({ data: JSON.stringify(payload.snapshot), event: 'snapshot' }).catch(() => {});
    };
    monitoring.on('snapshot', onSnapshot);

    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => clearInterval(keepalive));
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(keepalive);
      monitoring.off('snapshot', onSnapshot);
      monitoring.unregisterClient(databaseId);
    });

    await new Promise(() => {});
  });
});

// Postgres explorer
databaseRoutes.get('/:id/postgres/schemas', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const data = await service.listPostgresSchemas(c.req.param('id'));
  return c.json({ data });
});

databaseRoutes.get('/:id/postgres/tables', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const schema = c.req.query('schema');
  if (!schema) throw new AppError(400, 'VALIDATION_ERROR', 'schema is required');
  const data = await service.listPostgresTables(c.req.param('id'), schema);
  return c.json({ data });
});

databaseRoutes.get('/:id/postgres/table-metadata', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const query = BrowsePostgresRowsQuerySchema.pick({ schema: true, table: true }).parse(c.req.query());
  const data = await service.getPostgresTableMetadata(c.req.param('id'), query.schema, query.table);
  return c.json({ data });
});

databaseRoutes.get('/:id/postgres/rows', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const query = BrowsePostgresRowsQuerySchema.parse(c.req.query());
  const data = await service.browsePostgresRows(
    c.req.param('id'),
    query.schema,
    query.table,
    query.page,
    query.limit,
    query.sortBy,
    query.sortOrder
  );
  return c.json({ data });
});

databaseRoutes.post('/:id/postgres/rows', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const schema = BrowsePostgresRowsQuerySchema.pick({ schema: true, table: true }).parse(body);
  const values = PostgresObjectSchema.parse(body.values ?? {});
  const data = await service.insertPostgresRow(c.req.param('id'), schema.schema, schema.table, values, user.id);
  return c.json({ data }, 201);
});

databaseRoutes.patch('/:id/postgres/rows', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const schema = BrowsePostgresRowsQuerySchema.pick({ schema: true, table: true }).parse(body);
  const primaryKey = PostgresObjectSchema.parse(body.primaryKey ?? {});
  const values = PostgresObjectSchema.parse(body.values ?? {});
  const data = await service.updatePostgresRow(c.req.param('id'), schema.schema, schema.table, primaryKey, values, user.id);
  return c.json({ data });
});

databaseRoutes.delete('/:id/postgres/rows', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const schema = BrowsePostgresRowsQuerySchema.pick({ schema: true, table: true }).parse(body);
  const primaryKey = PostgresObjectSchema.parse(body.primaryKey ?? {});
  const data = await service.deletePostgresRow(c.req.param('id'), schema.schema, schema.table, primaryKey, user.id);
  return c.json({ data });
});

databaseRoutes.post('/:id/postgres/query', requireScopeForResource('databases:view', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const { sql } = ExecutePostgresSqlSchema.parse(await c.req.json());
  ensureQueryScope(c, c.req.param('id'), inferPostgresIntent(sql));
  const data = await service.executePostgresSql(c.req.param('id'), sql, user.id);
  return c.json({ data });
});

// Redis explorer
databaseRoutes.get('/:id/redis/keys', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const query = RedisScanKeysQuerySchema.parse(c.req.query());
  const data = await service.scanRedisKeys(c.req.param('id'), query.cursor, query.limit, query.search, query.type);
  return c.json({ data });
});

databaseRoutes.get('/:id/redis/key', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), [
    'databases:query:read',
    'databases:query:write',
    'databases:query:admin',
  ]);
  const service = container.resolve(DatabaseConnectionService);
  const query = RedisGetKeyQuerySchema.parse(c.req.query());
  const data = await service.getRedisKey(c.req.param('id'), query.key);
  return c.json({ data });
});

databaseRoutes.put('/:id/redis/key', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = RedisSetKeySchema.parse(await c.req.json());
  const data = await service.setRedisKey(c.req.param('id'), body.key, body.type, body.value, body.ttlSeconds, user.id);
  return c.json({ data });
});

databaseRoutes.delete('/:id/redis/key', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = RedisGetKeyQuerySchema.parse(await c.req.json());
  const data = await service.deleteRedisKey(c.req.param('id'), body.key, user.id);
  return c.json({ data });
});

databaseRoutes.post('/:id/redis/key/expire', requireScopeForResource('databases:view', 'id'), async (c) => {
  ensureAnyDatabaseScope(c, c.req.param('id'), ['databases:query:write', 'databases:query:admin']);
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const body = RedisExpireKeySchema.parse(await c.req.json());
  const data = await service.expireRedisKey(c.req.param('id'), body.key, body.ttlSeconds, user.id);
  return c.json({ data });
});

databaseRoutes.post('/:id/redis/command', requireScopeForResource('databases:view', 'id'), async (c) => {
  const service = container.resolve(DatabaseConnectionService);
  const user = c.get('user')!;
  const { command } = ExecuteRedisCommandSchema.parse(await c.req.json());
  ensureQueryScope(c, c.req.param('id'), inferRedisIntent(command));
  const data = await service.executeRedisCommand(c.req.param('id'), command, user.id);
  return c.json({ data });
});
