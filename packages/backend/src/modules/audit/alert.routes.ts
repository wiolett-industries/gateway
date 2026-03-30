import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { AlertService } from './alert.service.js';

export const alertRoutes = new OpenAPIHono<AppEnv>();

alertRoutes.use('*', authMiddleware);
alertRoutes.use('*', sessionOnly);

alertRoutes.get('/', async (c) => {
  const alertService = container.resolve(AlertService);
  const alerts = await alertService.getAlerts();
  return c.json(alerts);
});

alertRoutes.post('/:id/dismiss', rbacMiddleware('admin', 'operator'), async (c) => {
  const alertService = container.resolve(AlertService);
  const id = c.req.param('id');
  await alertService.dismissAlert(id);
  return c.json({ message: 'Alert dismissed' });
});
