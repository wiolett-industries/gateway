import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware, rbacMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  CreateProxyHostSchema,
  ProxyHostListQuerySchema,
  ToggleProxyHostSchema,
  UpdateProxyHostSchema,
  ValidateAdvancedConfigSchema,
} from './proxy.schemas.js';
import { ProxyService } from './proxy.service.js';

export const proxyRoutes = new OpenAPIHono<AppEnv>();

proxyRoutes.use('*', authMiddleware);
proxyRoutes.use('*', sessionOnly);

// List proxy hosts (any authenticated role)
proxyRoutes.get('/', async (c) => {
  const proxyService = container.resolve(ProxyService);
  const rawQuery = c.req.query();
  const query = ProxyHostListQuerySchema.parse(rawQuery);
  const result = await proxyService.listProxyHosts(query);
  return c.json(result);
});

// Get proxy host detail
proxyRoutes.get('/:id', async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id');
  const host = await proxyService.getProxyHost(id);
  return c.json({ data: host });
});

// Create proxy host (admin, operator)
proxyRoutes.post('/', rbacMiddleware('admin', 'operator'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateProxyHostSchema.parse(body);
  if (input.advancedConfig && user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires admin role');
  }
  const host = await proxyService.createProxyHost(input, user.id);
  return c.json({ data: host }, 201);
});

// Update proxy host (admin, operator)
proxyRoutes.put('/:id', rbacMiddleware('admin', 'operator'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateProxyHostSchema.parse(body);
  if (input.advancedConfig && user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires admin role');
  }
  const host = await proxyService.updateProxyHost(id, input, user.id);
  return c.json({ data: host });
});

// Delete proxy host (admin only)
proxyRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await proxyService.deleteProxyHost(id, user.id);
  return c.body(null, 204);
});

// Toggle proxy host enabled/disabled (admin, operator)
proxyRoutes.post('/:id/toggle', rbacMiddleware('admin', 'operator'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { enabled } = ToggleProxyHostSchema.parse(body);
  const host = await proxyService.toggleProxyHost(id, enabled, user.id);
  return c.json({ data: host });
});

// Get rendered nginx config for a host (admin, operator)
proxyRoutes.get('/:id/rendered-config', rbacMiddleware('admin', 'operator'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id');
  const rendered = await proxyService.getRenderedConfig(id);
  return c.json({ data: { rendered } });
});

// Validate advanced config snippet (admin, operator)
proxyRoutes.post('/validate-config', rbacMiddleware('admin', 'operator'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const body = await c.req.json();
  const { snippet } = ValidateAdvancedConfigSchema.parse(body);
  const result = await proxyService.validateAdvancedConfig(snippet);
  return c.json({ data: result });
});
