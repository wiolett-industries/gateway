import { z } from '@hono/zod-openapi';
import { appRoute, IdParamSchema, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

export const listAlertsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Alerts'],
  summary: 'List alerts',
  responses: okJson(UnknownDataResponseSchema),
});

export const dismissAlertRoute = appRoute({
  method: 'post',
  path: '/{id}/dismiss',
  tags: ['Alerts'],
  summary: 'Dismiss an alert',
  request: { params: IdParamSchema },
  responses: okJson(z.object({ message: z.string() })),
});
