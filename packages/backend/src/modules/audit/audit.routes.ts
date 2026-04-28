import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { listAuditLogRoute } from './audit.docs.js';
import { AuditService } from './audit.service.js';

export const auditRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

auditRoutes.use('*', authMiddleware);

auditRoutes.openapi({ ...listAuditLogRoute, middleware: requireScope('admin:audit') }, async (c) => {
  const auditService = container.resolve(AuditService);
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const action = c.req.query('action');
  const resourceType = c.req.query('resourceType');

  const result = await auditService.getAuditLog({
    action: action || undefined,
    resourceType: resourceType || undefined,
    page,
    limit: Math.min(limit, 100),
  });

  return c.json(result);
});
