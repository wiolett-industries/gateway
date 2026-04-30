import { z } from '@hono/zod-openapi';
import { appRoute, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.union([z.string(), z.array(z.string())]).optional(),
  resourceType: z.union([z.string(), z.array(z.string())]).optional(),
  userId: z.union([z.string(), z.array(z.string())]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  excludeAction: z.union([z.string(), z.array(z.string())]).optional(),
  excludeResourceType: z.union([z.string(), z.array(z.string())]).optional(),
});

export const listAuditLogRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'List audit log entries',
  request: { query: AuditQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const listAuditUsersRoute = appRoute({
  method: 'get',
  path: '/users',
  tags: ['Audit'],
  summary: 'List users present in audit log entries',
  responses: okJson(UnknownDataResponseSchema),
});
