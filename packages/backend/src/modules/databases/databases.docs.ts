import { z } from '@hono/zod-openapi';
import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
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

const PostgresTableQuerySchema = BrowsePostgresRowsQuerySchema.pick({ schema: true, table: true });
const PostgresInsertRowSchema = PostgresTableQuerySchema.extend({
  values: PostgresObjectSchema,
});
const PostgresUpdateRowSchema = PostgresInsertRowSchema.extend({
  primaryKey: PostgresObjectSchema,
});
const PostgresDeleteRowSchema = PostgresTableQuerySchema.extend({
  primaryKey: PostgresObjectSchema,
});

export const listDatabaseConnectionsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Databases'],
  summary: 'List database connections',
  request: { query: DatabaseListQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createDatabaseConnectionRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Databases'],
  summary: 'Create a database connection',
  request: jsonBody(CreateDatabaseConnectionSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const getDatabaseConnectionRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Databases'],
  summary: 'Get database connection details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const updateDatabaseConnectionRoute = appRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Databases'],
  summary: 'Update a database connection',
  request: { params: IdParamSchema, ...jsonBody(UpdateDatabaseConnectionSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteDatabaseConnectionRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Databases'],
  summary: 'Delete a database connection',
  request: { params: IdParamSchema },
  responses: okJson(z.object({ success: z.boolean() })),
});

export const testDatabaseConnectionRoute = appRoute({
  method: 'post',
  path: '/{id}/test',
  tags: ['Databases'],
  summary: 'Test a saved database connection',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const revealDatabaseCredentialsRoute = appRoute({
  method: 'get',
  path: '/{id}/reveal-credentials',
  tags: ['Databases'],
  summary: 'Reveal stored database credentials',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const databaseMonitoringStreamRoute = appRoute({
  method: 'get',
  path: '/{id}/monitoring/stream',
  tags: ['Databases'],
  summary: 'Stream database monitoring snapshots',
  request: { params: IdParamSchema },
  responses: { 200: { description: 'Server-sent events stream' } },
});

export const listPostgresSchemasRoute = appRoute({
  method: 'get',
  path: '/{id}/postgres/schemas',
  tags: ['Databases'],
  summary: 'List PostgreSQL schemas',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const listPostgresTablesRoute = appRoute({
  method: 'get',
  path: '/{id}/postgres/tables',
  tags: ['Databases'],
  summary: 'List PostgreSQL tables',
  request: { params: IdParamSchema, query: z.object({ schema: z.string().min(1) }) },
  responses: okJson(UnknownDataResponseSchema),
});

export const postgresTableMetadataRoute = appRoute({
  method: 'get',
  path: '/{id}/postgres/table-metadata',
  tags: ['Databases'],
  summary: 'Get PostgreSQL table metadata',
  request: { params: IdParamSchema, query: PostgresTableQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const browsePostgresRowsRoute = appRoute({
  method: 'get',
  path: '/{id}/postgres/rows',
  tags: ['Databases'],
  summary: 'Browse PostgreSQL table rows',
  request: { params: IdParamSchema, query: BrowsePostgresRowsQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const insertPostgresRowRoute = appRoute({
  method: 'post',
  path: '/{id}/postgres/rows',
  tags: ['Databases'],
  summary: 'Insert a PostgreSQL row',
  request: { params: IdParamSchema, ...jsonBody(PostgresInsertRowSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});

export const updatePostgresRowRoute = appRoute({
  method: 'patch',
  path: '/{id}/postgres/rows',
  tags: ['Databases'],
  summary: 'Update a PostgreSQL row',
  request: { params: IdParamSchema, ...jsonBody(PostgresUpdateRowSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deletePostgresRowRoute = appRoute({
  method: 'delete',
  path: '/{id}/postgres/rows',
  tags: ['Databases'],
  summary: 'Delete a PostgreSQL row',
  request: { params: IdParamSchema, ...jsonBody(PostgresDeleteRowSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const executePostgresQueryRoute = appRoute({
  method: 'post',
  path: '/{id}/postgres/query',
  tags: ['Databases'],
  summary: 'Execute a PostgreSQL SQL statement',
  request: { params: IdParamSchema, ...jsonBody(ExecutePostgresSqlSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const scanRedisKeysRoute = appRoute({
  method: 'get',
  path: '/{id}/redis/keys',
  tags: ['Databases'],
  summary: 'Scan Redis keys',
  request: { params: IdParamSchema, query: RedisScanKeysQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const getRedisKeyRoute = appRoute({
  method: 'get',
  path: '/{id}/redis/key',
  tags: ['Databases'],
  summary: 'Get a Redis key',
  request: { params: IdParamSchema, query: RedisGetKeyQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const setRedisKeyRoute = appRoute({
  method: 'put',
  path: '/{id}/redis/key',
  tags: ['Databases'],
  summary: 'Set a Redis key',
  request: { params: IdParamSchema, ...jsonBody(RedisSetKeySchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteRedisKeyRoute = appRoute({
  method: 'delete',
  path: '/{id}/redis/key',
  tags: ['Databases'],
  summary: 'Delete a Redis key',
  request: { params: IdParamSchema, ...jsonBody(RedisGetKeyQuerySchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const expireRedisKeyRoute = appRoute({
  method: 'post',
  path: '/{id}/redis/key/expire',
  tags: ['Databases'],
  summary: 'Set Redis key expiration',
  request: { params: IdParamSchema, ...jsonBody(RedisExpireKeySchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const executeRedisCommandRoute = appRoute({
  method: 'post',
  path: '/{id}/redis/command',
  tags: ['Databases'],
  summary: 'Execute a Redis command',
  request: { params: IdParamSchema, ...jsonBody(ExecuteRedisCommandSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
