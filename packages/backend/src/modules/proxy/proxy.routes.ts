import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import {
  authMiddleware,
  isProgrammaticAuth,
  requireScope,
  requireScopeForResource,
  sessionOnly,
} from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  createProxyHostRoute,
  deleteProxyHostRoute,
  getProxyHostHealthHistoryRoute,
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

function requestUsesRawProxyConfig(input: { type?: string; rawConfig?: unknown; rawConfigEnabled?: unknown }): boolean {
  return input.type === 'raw' || input.rawConfig !== undefined || input.rawConfigEnabled !== undefined;
}

function requestTogglesRawProxyConfig(input: { type?: string; rawConfigEnabled?: unknown }): boolean {
  return input.type === 'raw' || input.rawConfigEnabled !== undefined;
}

function stripRawProxyConfig<T extends Record<string, unknown>>(host: T): Omit<T, 'rawConfig' | 'rawConfigEnabled'> {
  const { rawConfig: _rawConfig, rawConfigEnabled: _rawConfigEnabled, ...rest } = host;
  return rest;
}

proxyRoutes.openapi({ ...listProxyHostsRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const query = ProxyHostListQuerySchema.parse(c.req.query());
  const result = await proxyService.listProxyHosts(query);
  if (isProgrammaticAuth(c)) {
    return c.json({ ...result, data: result.data.map((host: any) => stripRawProxyConfig(host)) });
  }
  return c.json(result);
});

proxyRoutes.openapi({ ...getProxyHostRoute, middleware: requireScopeForResource('proxy:view', 'id') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const id = c.req.param('id')!;
  const host = await proxyService.getProxyHost(id);
  if (isProgrammaticAuth(c)) return c.json({ data: stripRawProxyConfig(host as any) });
  return c.json({ data: host });
});

proxyRoutes.openapi(
  { ...getProxyHostHealthHistoryRoute, middleware: requireScopeForResource('proxy:view', 'id') },
  async (c) => {
    const proxyService = container.resolve(ProxyService);
    const id = c.req.param('id')!;
    const healthHistory = await proxyService.getProxyHostHealthHistory(id);
    return c.json({ data: healthHistory });
  }
);

proxyRoutes.openapi({ ...createProxyHostRoute, middleware: requireScope('proxy:create') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const input = CreateProxyHostSchema.parse(await c.req.json());
  if (isProgrammaticAuth(c) && requestUsesRawProxyConfig(input)) {
    return c.json(
      { code: 'BROWSER_SESSION_REQUIRED', message: 'Raw nginx config requires browser session authentication' },
      403
    );
  }
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, 'proxy:advanced')) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  const bypassAdvancedValidation = hasScope(scopes, 'proxy:advanced:bypass');
  if (requestTogglesRawProxyConfig(input) && !hasScope(scopes, 'proxy:raw:toggle')) {
    throw new AppError(403, 'FORBIDDEN', 'Enabling raw mode requires proxy:raw:toggle scope');
  }
  if (input.rawConfig !== undefined && !hasScope(scopes, 'proxy:raw:write')) {
    throw new AppError(403, 'FORBIDDEN', 'Writing raw config requires proxy:raw:write scope');
  }
  const host = await proxyService.createProxyHost(input, user.id, bypassAdvancedValidation);
  if (isProgrammaticAuth(c)) return c.json({ data: stripRawProxyConfig(host as any) }, 201);
  return c.json({ data: host }, 201);
});

proxyRoutes.openapi({ ...updateProxyHostRoute, middleware: requireScopeForResource('proxy:edit', 'id') }, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const input = UpdateProxyHostSchema.parse(await c.req.json());
  if (isProgrammaticAuth(c) && requestUsesRawProxyConfig(input)) {
    return c.json(
      { code: 'BROWSER_SESSION_REQUIRED', message: 'Raw nginx config requires browser session authentication' },
      403
    );
  }
  const scopes = c.get('effectiveScopes') || [];
  if (input.advancedConfig && !hasScope(scopes, `proxy:advanced:${id}`)) {
    throw new AppError(403, 'FORBIDDEN', 'Advanced config requires proxy:advanced scope');
  }
  const bypassAdvancedValidation = hasScope(scopes, `proxy:advanced:bypass:${id}`);
  if (requestTogglesRawProxyConfig(input)) {
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
  if (isProgrammaticAuth(c)) return c.json({ data: stripRawProxyConfig(host as any) });
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
  if (isProgrammaticAuth(c)) return c.json({ data: stripRawProxyConfig(host as any) });
  return c.json({ data: host });
});

proxyRoutes.openapi({ ...renderedProxyConfigRoute, middleware: sessionOnly }, async (c) => {
  const id = c.req.param('id')!;
  const scopes = c.get('effectiveScopes') || [];
  if (!hasScope(scopes, `proxy:raw:read:${id}`) && !hasScope(scopes, 'proxy:raw:read')) {
    return c.json({ message: `Missing required scope: proxy:raw:read:${id}` }, 403);
  }
  const proxyService = container.resolve(ProxyService);
  const rendered = await proxyService.getRenderedConfig(id);
  return c.json({ data: { rendered } });
});

proxyRoutes.openapi(validateProxyConfigRoute, async (c) => {
  const proxyService = container.resolve(ProxyService);
  const scopes = c.get('effectiveScopes') || [];
  const { snippet, mode, proxyHostId } = ValidateAdvancedConfigSchema.parse(await c.req.json());
  if (isProgrammaticAuth(c) && mode === 'raw') {
    return c.json(
      { code: 'BROWSER_SESSION_REQUIRED', message: 'Raw nginx config requires browser session authentication' },
      403
    );
  }

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
