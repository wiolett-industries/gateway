import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import { AlertService } from './alert.service.js';
import type { AppEnv } from '@/types.js';

export const alertRoutes = new OpenAPIHono<AppEnv>();

alertRoutes.use('*', authMiddleware);

alertRoutes.get('/', async (c) => {
  const alertService = container.resolve(AlertService);
  const alerts = await alertService.getAlerts();
  return c.json(alerts);
});

alertRoutes.post('/:id/dismiss', async (c) => {
  const alertService = container.resolve(AlertService);
  const id = c.req.param('id');
  await alertService.dismissAlert(id);
  return c.json({ message: 'Alert dismissed' });
});
