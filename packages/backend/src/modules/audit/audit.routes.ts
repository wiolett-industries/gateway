import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { AuditService } from './audit.service.js';
import type { AppEnv } from '@/types.js';

export const auditRoutes = new OpenAPIHono<AppEnv>();

auditRoutes.use('*', authMiddleware);
auditRoutes.use('*', rbacMiddleware('admin'));

auditRoutes.get('/', async (c) => {
  const auditService = container.resolve(AuditService);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
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
