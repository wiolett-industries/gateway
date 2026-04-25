import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { LicenseService } from './license.service.js';

export const licenseRoutes = new OpenAPIHono<AppEnv>();

licenseRoutes.use('*', authMiddleware);
licenseRoutes.use('*', sessionOnly);

const ActivateSchema = z.object({
  licenseKey: z.string().min(1),
});

licenseRoutes.get('/status', requireScope('license:view'), async (c) => {
  const service = container.resolve(LicenseService);
  return c.json({ data: await service.getStatus() });
});

licenseRoutes.post('/activate', requireScope('license:manage'), async (c) => {
  const body = ActivateSchema.parse(await c.req.json());
  const service = container.resolve(LicenseService);
  return c.json({ data: await service.activateKey(body.licenseKey) });
});

licenseRoutes.post('/check', requireScope('license:manage'), async (c) => {
  const service = container.resolve(LicenseService);
  return c.json({ data: await service.checkNow() });
});

licenseRoutes.delete('/key', requireScope('license:manage'), async (c) => {
  const service = container.resolve(LicenseService);
  return c.json({ data: await service.clearKey() });
});
