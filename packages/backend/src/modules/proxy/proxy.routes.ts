import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware, requireScope, requireScopeForResource, sessionOnly } from '@/modules/auth/auth.middleware.js';
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

// List proxy hosts
proxyRoutes.get('/', requireScope('proxy:list'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const rawQuery = c.req.query();
  const query = ProxyHostListQuerySchema.parse(rawQuery);
  const result = await proxyService.listProxyHosts(query);
  return c.json(result);
});

// Get proxy host detail
proxyRoutes.get('/:id', requireScopeForResource('proxy:view', 'id'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id');
  const host = await proxyService.getProxyHost(id);
  return c.json({ data: host });
});

// Create proxy host
proxyRoutes.post('/', requireScope('proxy:create'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateProxyHostSchema.parse(body);
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, 'proxy:advanced')) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  if (input.rawConfigEnabled && !hasScope(scopes, 'proxy:raw:toggle')) {
    throw new AppError(403, 'FORBIDDEN', 'Enabling raw mode requires proxy:raw:toggle scope');
  }
  const host = await proxyService.createProxyHost(input, user.id);
  return c.json({ data: host }, 201);
});

// Update proxy host
proxyRoutes.put('/:id', requireScopeForResource('proxy:edit', 'id'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateProxyHostSchema.parse(body);
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, 'proxy:advanced')) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  if (input.rawConfigEnabled !== undefined) {
    if (!hasScope(scopes, `proxy:raw:toggle:${id}`) && !hasScope(scopes, 'proxy:raw:toggle')) {
      throw new AppError(403, 'FORBIDDEN', 'Toggling raw mode requires proxy:raw:toggle scope');
    }
  }
  if (input.rawConfig !== undefined) {
    if (!hasScope(scopes, `proxy:raw:write:${id}`) && !hasScope(scopes, 'proxy:raw:write')) {
      throw new AppError(403, 'FORBIDDEN', 'Writing raw config requires proxy:raw:write scope');
    }
  }
  const host = await proxyService.updateProxyHost(id, input, user.id);
  return c.json({ data: host });
});

// Delete proxy host
proxyRoutes.delete('/:id', requireScopeForResource('proxy:delete', 'id'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await proxyService.deleteProxyHost(id, user.id);
  return c.body(null, 204);
});

// Toggle proxy host enabled/disabled
proxyRoutes.post('/:id/toggle', requireScopeForResource('proxy:edit', 'id'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { enabled } = ToggleProxyHostSchema.parse(body);
  const host = await proxyService.toggleProxyHost(id, enabled, user.id);
  return c.json({ data: host });
});

// Get rendered nginx config for a host
proxyRoutes.get('/:id/rendered-config', requireScopeForResource('proxy:raw:read', 'id'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id');
  const rendered = await proxyService.getRenderedConfig(id);
  return c.json({ data: { rendered } });
});

// Validate advanced config snippet
proxyRoutes.post('/validate-config', requireScope('proxy:advanced'), async (c) => {
  const proxyService = container.resolve(ProxyService);
  const body = await c.req.json();
  const { snippet, mode } = ValidateAdvancedConfigSchema.parse(body);
  const result = await proxyService.validateAdvancedConfig(snippet, mode === 'raw');
  return c.json({ data: result });
});
