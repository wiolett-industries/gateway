import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { dismissAlertRoute, listAlertsRoute } from './alert.docs.js';
import { AlertService } from './alert.service.js';

export const alertRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

alertRoutes.use('*', authMiddleware);

alertRoutes.openapi({ ...listAlertsRoute, middleware: requireScope('admin:alerts') }, async (c) => {
  const alertService = container.resolve(AlertService);
  const alerts = await alertService.getAlerts();
  return c.json(alerts);
});

alertRoutes.openapi({ ...dismissAlertRoute, middleware: requireScope('admin:alerts') }, async (c) => {
  const alertService = container.resolve(AlertService);
  const id = c.req.param('id')!;
  await alertService.dismissAlert(id);
  return c.json({ message: 'Alert dismissed' });
});
