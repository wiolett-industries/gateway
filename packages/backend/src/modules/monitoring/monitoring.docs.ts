import { appRoute, okJson, pathParamSchema, UnknownDataResponseSchema } from '@/lib/openapi.js';

const hostParams = pathParamSchema('hostId');

export const dashboardStatsRoute = appRoute({
  method: 'get',
  path: '/dashboard',
  tags: ['Monitoring'],
  summary: 'Get dashboard monitoring stats',
  responses: okJson(UnknownDataResponseSchema),
});

export const healthStatusRoute = appRoute({
  method: 'get',
  path: '/health-status',
  tags: ['Monitoring'],
  summary: 'Get proxy health status overview',
  responses: okJson(UnknownDataResponseSchema),
});

export const proxyLogStreamRoute = appRoute({
  method: 'get',
  path: '/logs/{hostId}/stream',
  tags: ['Monitoring'],
  summary: 'Stream proxy host logs',
  request: { params: hostParams },
  responses: { 200: { description: 'Server-sent events stream' } },
});
