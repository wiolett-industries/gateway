import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  CreateStatusPageIncidentSchema,
  CreateStatusPageIncidentUpdateSchema,
  CreateStatusPageServiceSchema,
  IncidentListQuerySchema,
  StatusPageSettingsSchema,
  UpdateStatusPageIncidentSchema,
  UpdateStatusPageServiceSchema,
} from './status-page.schemas.js';
import { StatusPageService } from './status-page.service.js';

export const statusPageRoutes = new OpenAPIHono<AppEnv>();
export const publicStatusPageRoutes = new OpenAPIHono<AppEnv>();

statusPageRoutes.use('*', authMiddleware);
statusPageRoutes.use('*', sessionOnly);

statusPageRoutes.get('/settings', requireScope('status-page:view'), async (c) => {
  const service = container.resolve(StatusPageService);
  return c.json({ data: await service.getConfig() });
});

statusPageRoutes.get('/proxy-templates', requireScope('status-page:view'), async (c) => {
  const service = container.resolve(StatusPageService);
  return c.json({ data: await service.listProxyTemplates() });
});

statusPageRoutes.put('/settings', requireScope('status-page:manage'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = StatusPageSettingsSchema.parse(await c.req.json());
  return c.json({ data: await service.updateSettings(input, user.id) });
});

statusPageRoutes.get('/services', requireScope('status-page:view'), async (c) => {
  const service = container.resolve(StatusPageService);
  return c.json({ data: await service.listServices() });
});

statusPageRoutes.post('/services', requireScope('status-page:manage'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = CreateStatusPageServiceSchema.parse(await c.req.json());
  return c.json({ data: await service.createService(input, user.id) }, 201);
});

statusPageRoutes.put('/services/:id', requireScope('status-page:manage'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = UpdateStatusPageServiceSchema.parse(await c.req.json());
  return c.json({ data: await service.updateService(c.req.param('id'), input, user.id) });
});

statusPageRoutes.delete('/services/:id', requireScope('status-page:manage'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  await service.deleteService(c.req.param('id'), user.id);
  return c.body(null, 204);
});

statusPageRoutes.get('/incidents', requireScope('status-page:view'), async (c) => {
  const service = container.resolve(StatusPageService);
  const query = IncidentListQuerySchema.parse(c.req.query());
  return c.json({ data: await service.listIncidents(query) });
});

statusPageRoutes.post('/incidents', requireScope('status-page:incidents:create'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = CreateStatusPageIncidentSchema.parse(await c.req.json());
  return c.json({ data: await service.createManualIncident(input, user.id) }, 201);
});

statusPageRoutes.put('/incidents/:id', requireScope('status-page:incidents:update'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = UpdateStatusPageIncidentSchema.parse(await c.req.json());
  return c.json({ data: await service.updateIncident(c.req.param('id'), input, user.id) });
});

statusPageRoutes.delete('/incidents/:id', requireScope('status-page:incidents:delete'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  await service.deleteIncident(c.req.param('id'), user.id);
  return c.body(null, 204);
});

statusPageRoutes.post('/incidents/:id/resolve', requireScope('status-page:incidents:resolve'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  return c.json({ data: await service.resolveIncident(c.req.param('id'), user.id) });
});

statusPageRoutes.post('/incidents/:id/promote', requireScope('status-page:incidents:create'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  return c.json({ data: await service.promoteIncident(c.req.param('id'), user.id) });
});

statusPageRoutes.post('/incidents/:id/updates', requireScope('status-page:incidents:update'), async (c) => {
  const service = container.resolve(StatusPageService);
  const user = c.get('user')!;
  const input = CreateStatusPageIncidentUpdateSchema.parse(await c.req.json());
  return c.json({ data: await service.createIncidentUpdate(c.req.param('id'), input, user.id) }, 201);
});

statusPageRoutes.get('/preview', requireScope('status-page:view'), async (c) => {
  const service = container.resolve(StatusPageService);
  return c.json({ data: await service.getPreviewDto() });
});

publicStatusPageRoutes.get('/', async (c) => {
  const service = container.resolve(StatusPageService);
  if (!(await service.isStatusHost(c.req.header('host')))) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  const dto = await service.getPublicDto();
  if (!dto) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return c.json({ data: dto });
});
