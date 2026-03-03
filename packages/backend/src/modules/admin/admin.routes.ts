import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import type { AppEnv } from '@/types.js';

export const adminRoutes = new OpenAPIHono<AppEnv>();

// All admin routes require admin role
adminRoutes.use('*', authMiddleware);
adminRoutes.use('*', rbacMiddleware('admin'));

const UpdateRoleSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']),
});

// List all users
adminRoutes.get('/users', async (c) => {
  const authService = container.resolve(AuthService);
  const userList = await authService.listUsers();
  return c.json(userList);
});

// Update user role
adminRoutes.patch('/users/:id/role', async (c) => {
  const authService = container.resolve(AuthService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const userId = c.req.param('id');
  const body = await c.req.json();
  const { role } = UpdateRoleSchema.parse(body);

  const updatedUser = await authService.updateUserRole(userId, role);

  await auditService.log({
    userId: currentUser.id,
    action: 'user.role_update',
    resourceType: 'user',
    resourceId: userId,
    details: { newRole: role },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(updatedUser);
});
