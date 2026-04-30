import { z } from '@hono/zod-openapi';
import {
  appRoute,
  createdJson,
  dataResponseSchema,
  IdParamSchema,
  jsonBody,
  okJson,
  successJson,
  UnknownDataResponseSchema,
} from '@/lib/openapi.js';
import {
  CreateNodeSchema,
  NodeListQuerySchema,
  UpdateNodeSchema,
  UpdateNodeServiceCreationLockSchema,
} from './nodes.schemas.js';

const ConfigBodySchema = z.object({
  content: z.string().min(1).openapi({ example: 'worker_processes auto;' }),
});

const NodeConfigResponseSchema = dataResponseSchema(
  z.object({
    content: z.string(),
  })
);

const ConfigTestResponseSchema = dataResponseSchema(
  z.object({
    valid: z.boolean(),
    error: z.string().optional(),
  })
);

const LogQuerySchema = z.object({
  level: z.string().optional().openapi({ example: 'info,warn,error' }),
  search: z.string().optional(),
});

export const listNodesRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Nodes'],
  summary: 'List nodes',
  request: { query: NodeListQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const getNodeRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Get node details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const getNodeHealthHistoryRoute = appRoute({
  method: 'get',
  path: '/{id}/health-history',
  tags: ['Nodes'],
  summary: 'Get node health history',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createNodeRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Nodes'],
  summary: 'Create node enrollment',
  request: jsonBody(CreateNodeSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateNodeRoute = appRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Update node display metadata',
  request: { params: IdParamSchema, ...jsonBody(UpdateNodeSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const updateNodeServiceCreationLockRoute = appRoute({
  method: 'patch',
  path: '/{id}/service-creation-lock',
  tags: ['Nodes'],
  summary: 'Lock or unlock new service creation on a node',
  request: { params: IdParamSchema, ...jsonBody(UpdateNodeServiceCreationLockSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteNodeRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Delete a node',
  request: { params: IdParamSchema },
  responses: successJson,
});

export const getNodeConfigRoute = appRoute({
  method: 'get',
  path: '/{id}/config',
  tags: ['Nodes'],
  summary: 'Read nginx global config from a node',
  request: { params: IdParamSchema },
  responses: okJson(NodeConfigResponseSchema),
});

export const updateNodeConfigRoute = appRoute({
  method: 'put',
  path: '/{id}/config',
  tags: ['Nodes'],
  summary: 'Update nginx global config on a node',
  request: { params: IdParamSchema, ...jsonBody(ConfigBodySchema) },
  responses: okJson(ConfigTestResponseSchema),
});

export const testNodeConfigRoute = appRoute({
  method: 'post',
  path: '/{id}/config/test',
  tags: ['Nodes'],
  summary: 'Test nginx config on a node',
  request: { params: IdParamSchema },
  responses: okJson(ConfigTestResponseSchema),
});

export const nodeMonitoringStreamRoute = appRoute({
  method: 'get',
  path: '/{id}/monitoring/stream',
  tags: ['Nodes'],
  summary: 'Stream node monitoring snapshots over SSE',
  request: { params: IdParamSchema },
  responses: { 200: { description: 'Server-sent event stream' } },
});

export const nodeDaemonLogsRoute = appRoute({
  method: 'get',
  path: '/{id}/logs',
  tags: ['Nodes'],
  summary: 'Stream daemon logs for a node',
  request: { params: IdParamSchema, query: LogQuerySchema },
  responses: { 200: { description: 'Server-sent event stream' } },
});

export const nodeNginxLogsRoute = appRoute({
  method: 'get',
  path: '/{id}/nginx-logs',
  tags: ['Nodes'],
  summary: 'Stream nginx access and error logs for a node',
  request: {
    params: IdParamSchema,
    query: LogQuerySchema.extend({
      hostId: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Server-sent event stream' } },
});
