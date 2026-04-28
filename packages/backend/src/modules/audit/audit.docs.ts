import { z } from '@hono/zod-openapi';
import { appRoute, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
  resourceType: z.string().optional(),
});

export const listAuditLogRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'List audit log entries',
  request: { query: AuditQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});
