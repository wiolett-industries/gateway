import { z } from '@hono/zod-openapi';
import {
  appRoute,
  createdJson,
  IdParamSchema,
  jsonBody,
  okJson,
  pathParamSchema,
  UnknownDataResponseSchema,
} from '@/lib/openapi.js';
import {
  CreateLoggingEnvironmentSchema,
  CreateLoggingSchemaSchema,
  CreateLoggingTokenSchema,
  LoggingBatchSchema,
  LoggingFacetsQuerySchema,
  UpdateLoggingEnvironmentSchema,
  UpdateLoggingSchemaSchema,
} from './logging.schemas.js';

const schemaParams = pathParamSchema('schemaId');
const tokenParams = pathParamSchema('id', 'tokenId');
const LoggingSearchDocsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(),
  services: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  expression: z.unknown().optional(),
});

export const loggingStatusRoute = appRoute({
  method: 'get',
  path: '/status',
  tags: ['Logging'],
  summary: 'Get logging feature status',
  security: [],
  responses: okJson(UnknownDataResponseSchema),
});
export const loggingIngestRoute = appRoute({
  method: 'post',
  path: '/ingest',
  tags: ['Logging'],
  summary: 'Ingest one log event',
  security: [],
  request: jsonBody(z.unknown()),
  responses: okJson(UnknownDataResponseSchema),
});
export const loggingBatchIngestRoute = appRoute({
  method: 'post',
  path: '/ingest/batch',
  tags: ['Logging'],
  summary: 'Ingest a batch of log events',
  security: [],
  request: jsonBody(LoggingBatchSchema),
  responses: okJson(UnknownDataResponseSchema),
});
export const listLoggingEnvironmentsRoute = appRoute({
  method: 'get',
  path: '/environments',
  tags: ['Logging'],
  summary: 'List logging environments',
  request: { query: z.object({ search: z.string().optional() }) },
  responses: okJson(UnknownDataResponseSchema),
});
export const createLoggingEnvironmentRoute = appRoute({
  method: 'post',
  path: '/environments',
  tags: ['Logging'],
  summary: 'Create a logging environment',
  request: jsonBody(CreateLoggingEnvironmentSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const getLoggingEnvironmentRoute = appRoute({
  method: 'get',
  path: '/environments/{id}',
  tags: ['Logging'],
  summary: 'Get a logging environment',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const updateLoggingEnvironmentRoute = appRoute({
  method: 'put',
  path: '/environments/{id}',
  tags: ['Logging'],
  summary: 'Update a logging environment',
  request: { params: IdParamSchema, ...jsonBody(UpdateLoggingEnvironmentSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteLoggingEnvironmentRoute = appRoute({
  method: 'delete',
  path: '/environments/{id}',
  tags: ['Logging'],
  summary: 'Delete a logging environment',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});
export const listLoggingSchemasRoute = appRoute({
  method: 'get',
  path: '/schemas',
  tags: ['Logging'],
  summary: 'List logging schemas',
  request: { query: z.object({ search: z.string().optional() }) },
  responses: okJson(UnknownDataResponseSchema),
});
export const createLoggingSchemaRoute = appRoute({
  method: 'post',
  path: '/schemas',
  tags: ['Logging'],
  summary: 'Create a logging schema',
  request: jsonBody(CreateLoggingSchemaSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const getLoggingSchemaRoute = appRoute({
  method: 'get',
  path: '/schemas/{schemaId}',
  tags: ['Logging'],
  summary: 'Get a logging schema',
  request: { params: schemaParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const updateLoggingSchemaRoute = appRoute({
  method: 'put',
  path: '/schemas/{schemaId}',
  tags: ['Logging'],
  summary: 'Update a logging schema',
  request: { params: schemaParams, ...jsonBody(UpdateLoggingSchemaSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteLoggingSchemaRoute = appRoute({
  method: 'delete',
  path: '/schemas/{schemaId}',
  tags: ['Logging'],
  summary: 'Delete a logging schema',
  request: { params: schemaParams },
  responses: { 204: { description: 'No content' } },
});
export const listLoggingTokensRoute = appRoute({
  method: 'get',
  path: '/environments/{id}/tokens',
  tags: ['Logging'],
  summary: 'List logging tokens',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const createLoggingTokenRoute = appRoute({
  method: 'post',
  path: '/environments/{id}/tokens',
  tags: ['Logging'],
  summary: 'Create a logging token',
  request: { params: IdParamSchema, ...jsonBody(CreateLoggingTokenSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const deleteLoggingTokenRoute = appRoute({
  method: 'delete',
  path: '/environments/{id}/tokens/{tokenId}',
  tags: ['Logging'],
  summary: 'Delete a logging token',
  request: { params: tokenParams },
  responses: { 204: { description: 'No content' } },
});
export const searchLogsRoute = appRoute({
  method: 'post',
  path: '/environments/{id}/search',
  tags: ['Logging'],
  summary: 'Search logs',
  request: { params: IdParamSchema, ...jsonBody(LoggingSearchDocsSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const loggingFacetsRoute = appRoute({
  method: 'get',
  path: '/environments/{id}/facets',
  tags: ['Logging'],
  summary: 'Get log facets',
  request: { params: IdParamSchema, query: LoggingFacetsQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const loggingMetadataRoute = appRoute({
  method: 'get',
  path: '/environments/{id}/metadata',
  tags: ['Logging'],
  summary: 'Get log metadata',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});
