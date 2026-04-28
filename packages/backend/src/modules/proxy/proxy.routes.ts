import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware, requireScope, requireScopeForResource, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  createProxyHostRoute,
  deleteProxyHostRoute,
  getProxyHostRoute,
  listProxyHostsRoute,
  renderedProxyConfigRoute,
  toggleProxyHostRoute,
  updateProxyHostRoute,
  validateProxyConfigRoute,
} from './proxy.docs.js';
import {
  CreateProxyHostSchema,
  ProxyHostListQuerySchema,
  ToggleProxyHostSchema,
  UpdateProxyHostSchema,
  ValidateAdvancedConfigSchema,
} from './proxy.schemas.js';
import { ProxyService } from './proxy.service.js';

export const proxyRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

proxyRoutes.use('*', authMiddleware);
proxyRoutes.use('*', sessionOnly);

proxyRoutes.openapi({ ...listProxyHostsRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const query = ProxyHostListQuerySchema.parse(c.req.query());
  const result = await proxyService.listProxyHosts(query);
  return c.json(result);
});

proxyRoutes.openapi({ ...getProxyHostRoute, middleware: requireScopeForResource('proxy:view', 'id') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id')!;
  const host = await proxyService.getProxyHost(id);
  return c.json({ data: host });
});

proxyRoutes.openapi({ ...createProxyHostRoute, middleware: requireScope('proxy:create') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const input = CreateProxyHostSchema.parse(await c.req.json());
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, 'proxy:advanced')) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  const bypassAdvancedValidation = hasScope(scopes, 'proxy:advanced:bypass');
  if (input.rawConfigEnabled && !hasScope(scopes, 'proxy:raw:toggle')) {
    throw new AppError(403, 'FORBIDDEN', 'Enabling raw mode requires proxy:raw:toggle scope');
  }
  const host = await proxyService.createProxyHost(input, user.id, bypassAdvancedValidation);
  return c.json({ data: host }, 201);
});

proxyRoutes.openapi({ ...updateProxyHostRoute, middleware: requireScopeForResource('proxy:edit', 'id') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const input = UpdateProxyHostSchema.parse(await c.req.json());
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, `proxy:advanced:${id}`)) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  const bypassAdvancedValidation = hasScope(scopes, `proxy:advanced:bypass:${id}`);
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
  const host = await proxyService.updateProxyHost(id, input, user.id, bypassAdvancedValidation);
  return c.json({ data: host });
});

proxyRoutes.openapi(
  { ...deleteProxyHostRoute, middleware: requireScopeForResource('proxy:delete', 'id') },
  async (c) => {
    const proxyService = container.resolve(ProxyService);
    const user = c.get('user')!;
    const id = c.req.param('id')!;
    await proxyService.deleteProxyHost(id, user.id);
    return c.body(null, 204);
  }
);

proxyRoutes.openapi({ ...toggleProxyHostRoute, middleware: requireScopeForResource('proxy:edit', 'id') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const { enabled } = ToggleProxyHostSchema.parse(await c.req.json());
  const host = await proxyService.toggleProxyHost(id, enabled, user.id);
  return c.json({ data: host });
});

proxyRoutes.openapi(
  { ...renderedProxyConfigRoute, middleware: requireScopeForResource('proxy:raw:read', 'id') },
  async (c) => {
    const proxyService = container.resolve(ProxyService);
    const id = c.req.param('id')!;
    const rendered = await proxyService.getRenderedConfig(id);
    return c.json({ data: { rendered } });
  }
);

proxyRoutes.openapi(validateProxyConfigRoute, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const scopes = c.get('effectiveScopes') || [];
  const { snippet, mode, proxyHostId } = ValidateAdvancedConfigSchema.parse(await c.req.json());

  const advancedScope = proxyHostId ? `proxy:advanced:${proxyHostId}` : 'proxy:advanced';
  if (!hasScope(scopes, advancedScope)) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }

  const bypassScope = proxyHostId ? `proxy:advanced:bypass:${proxyHostId}` : 'proxy:advanced:bypass';
  const result = await proxyService.validateAdvancedConfig(
    snippet,
    mode === 'raw',
    mode === 'advanced' && hasScope(scopes, bypassScope)
  );
  return c.json({ data: result });
});
