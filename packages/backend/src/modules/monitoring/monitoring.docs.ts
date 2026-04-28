import { z } from '@hono/zod-openapi';
import { appRoute, jsonBody, okJson, pathParamSchema, UnknownDataResponseSchema } from '@/lib/openapi.js';

const hostParams = pathParamSchema('hostId');
const NginxConfigSchema = z.object({
  content: z.string().min(1),
});

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

export const nginxAvailableRoute = appRoute({
  method: 'get',
  path: '/nginx/available',
  tags: ['Monitoring'],
  summary: 'Check nginx daemon availability',
  responses: okJson(UnknownDataResponseSchema),
});

export const nginxInfoRoute = appRoute({
  method: 'get',
  path: '/nginx/info',
  tags: ['Monitoring'],
  summary: 'Get nginx process information',
  responses: okJson(UnknownDataResponseSchema),
});

export const nginxStatsStreamRoute = appRoute({
  method: 'get',
  path: '/nginx/stats/stream',
  tags: ['Monitoring'],
  summary: 'Stream nginx stats',
  responses: { 200: { description: 'Server-sent events stream' } },
});

export const nginxConfigRoute = appRoute({
  method: 'get',
  path: '/nginx/config',
  tags: ['Monitoring'],
  summary: 'Get global nginx config',
  responses: okJson(UnknownDataResponseSchema),
});

export const updateNginxConfigRoute = appRoute({
  method: 'put',
  path: '/nginx/config',
  tags: ['Monitoring'],
  summary: 'Update global nginx config',
  request: jsonBody(NginxConfigSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const testNginxConfigRoute = appRoute({
  method: 'post',
  path: '/nginx/config/test',
  tags: ['Monitoring'],
  summary: 'Test current nginx config',
  responses: okJson(UnknownDataResponseSchema),
});
