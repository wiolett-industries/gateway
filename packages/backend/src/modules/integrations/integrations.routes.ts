import { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { assertConnectorOperationAccess } from './integration-permissions.js';
import {
  createCloudflareConnectorRoute,
  createGitLabConnectorRoute,
  deleteCloudflareConnectorRoute,
  deleteGitLabConnectorRoute,
  getCloudflareConnectorRoute,
  getGitLabConnectorCapabilitiesRoute,
  getGitLabConnectorRoute,
  listCloudflareConnectorsRoute,
  listCloudflareZonesRoute,
  listGitLabAllowlistOptionsRoute,
  listGitLabConnectorsRoute,
  previewCloudflareConnectorTestRoute,
  previewGitLabAllowlistRoute,
  previewGitLabConnectorTestRoute,
  refreshGitLabAllowlistOptionsRoute,
  rotateCloudflareConnectorTokenRoute,
  rotateGitLabConnectorTokenRoute,
  searchGitLabAllowlistRoute,
  syncCloudflareConnectorRoute,
  syncGitLabConnectorRoute,
  testCloudflareConnectorRoute,
  testGitLabConnectorRoute,
  updateCloudflareConnectorRoute,
  updateGitLabConnectorRoute,
} from './integrations.docs.js';
import {
  CloudflareConnectorCreateSchema,
  CloudflareConnectorListQuerySchema,
  CloudflareConnectorPreviewTestSchema,
  CloudflareConnectorRotateTokenSchema,
  CloudflareConnectorUpdateSchema,
  GitLabAllowlistPreviewSearchSchema,
  GitLabAllowlistSearchQuerySchema,
  GitLabConnectorCreateSchema,
  GitLabConnectorListQuerySchema,
  GitLabConnectorPreviewTestSchema,
  GitLabConnectorRotateTokenSchema,
  GitLabConnectorUpdateSchema,
} from './integrations.schemas.js';
import { IntegrationsService } from './integrations.service.js';

export const integrationsRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

integrationsRoutes.use('*', authMiddleware);

function requireGitLabOperation(
  operation: string,
  requiredScope: string | readonly string[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')!;
    assertConnectorOperationAccess({
      actor: { userId: user.id, scopes: c.get('effectiveScopes') ?? user.scopes },
      provider: 'gitlab',
      connectorId: c.req.param('id') ?? null,
      operation,
      requiredScope,
    });
    await next();
  };
}

function requireCloudflareOperation(
  operation: string,
  requiredScope: string | readonly string[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')!;
    assertConnectorOperationAccess({
      actor: { userId: user.id, scopes: c.get('effectiveScopes') ?? user.scopes },
      provider: 'cloudflare',
      connectorId: c.req.param('id') ?? null,
      operation,
      requiredScope,
    });
    await next();
  };
}

integrationsRoutes.openapi(
  {
    ...listGitLabConnectorsRoute,
    middleware: requireGitLabOperation('connector.list', ['integrations:gitlab:view', 'integrations:gitlab:manage']),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const query = GitLabConnectorListQuerySchema.parse(c.req.query());
    const data = await service.listGitLabConnectors(query);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...listCloudflareConnectorsRoute,
    middleware: requireCloudflareOperation('connector.list', [
      'integrations:cloudflare:view',
      'integrations:cloudflare:dns:view',
      'integrations:cloudflare:dns:edit',
      'integrations:cloudflare:dns:delete',
      'integrations:cloudflare:manage',
    ]),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const query = CloudflareConnectorListQuerySchema.parse(c.req.query());
    const data = await service.listCloudflareConnectors(query);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...createCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.create', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = CloudflareConnectorCreateSchema.parse(await c.req.json());
    const data = await service.createCloudflareConnector(input, user.id);
    return c.json({ data }, 201);
  }
);

integrationsRoutes.openapi(
  {
    ...previewCloudflareConnectorTestRoute,
    middleware: requireCloudflareOperation('connector.preview_test', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const input = CloudflareConnectorPreviewTestSchema.parse(await c.req.json());
    const data = await service.testCloudflareConnectorPreview(input);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...getCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.get', [
      'integrations:cloudflare:view',
      'integrations:cloudflare:dns:view',
      'integrations:cloudflare:dns:edit',
      'integrations:cloudflare:dns:delete',
      'integrations:cloudflare:manage',
    ]),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const data = await service.getCloudflareConnector(c.req.param('id')!);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...updateCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.update', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = CloudflareConnectorUpdateSchema.parse(await c.req.json());
    const data = await service.updateCloudflareConnector(c.req.param('id')!, input, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...deleteCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.delete', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    await service.deleteCloudflareConnector(c.req.param('id')!, user.id);
    return c.json({ success: true });
  }
);

integrationsRoutes.openapi(
  {
    ...rotateCloudflareConnectorTokenRoute,
    middleware: requireCloudflareOperation('connector.token.rotate', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = CloudflareConnectorRotateTokenSchema.parse(await c.req.json());
    const data = await service.rotateCloudflareConnectorToken(c.req.param('id')!, input.token, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...testCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.test', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const data = await service.testCloudflareConnector(c.req.param('id')!, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...syncCloudflareConnectorRoute,
    middleware: requireCloudflareOperation('connector.sync', 'integrations:cloudflare:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const data = await service.syncCloudflareConnector(c.req.param('id')!, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...listCloudflareZonesRoute,
    middleware: requireCloudflareOperation('connector.zones.list', [
      'integrations:cloudflare:view',
      'integrations:cloudflare:dns:view',
      'integrations:cloudflare:manage',
    ]),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const data = await service.listCloudflareZones(c.req.param('id')!);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...createGitLabConnectorRoute,
    middleware: requireGitLabOperation('connector.create', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = GitLabConnectorCreateSchema.parse(await c.req.json());
    const data = await service.createGitLabConnector(input, user.id);
    return c.json({ data }, 201);
  }
);

integrationsRoutes.openapi(
  {
    ...previewGitLabConnectorTestRoute,
    middleware: requireGitLabOperation('connector.preview_test', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const input = GitLabConnectorPreviewTestSchema.parse(await c.req.json());
    const data = await service.testGitLabConnectorPreview(input);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...previewGitLabAllowlistRoute,
    middleware: requireGitLabOperation('connector.allowlist.preview_search', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const input = GitLabAllowlistPreviewSearchSchema.parse(await c.req.json());
    const data = await service.searchGitLabAllowlistPreview(input);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...getGitLabConnectorRoute,
    middleware: requireGitLabOperation('connector.get', ['integrations:gitlab:view', 'integrations:gitlab:manage']),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const data = await service.getGitLabConnector(c.req.param('id')!);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...updateGitLabConnectorRoute,
    middleware: requireGitLabOperation('connector.update', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = GitLabConnectorUpdateSchema.parse(await c.req.json());
    const data = await service.updateGitLabConnector(c.req.param('id')!, input, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...deleteGitLabConnectorRoute,
    middleware: requireGitLabOperation('connector.delete', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    await service.deleteGitLabConnector(c.req.param('id')!, user.id);
    return c.json({ success: true });
  }
);

integrationsRoutes.openapi(
  {
    ...rotateGitLabConnectorTokenRoute,
    middleware: requireGitLabOperation('connector.token.rotate', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const input = GitLabConnectorRotateTokenSchema.parse(await c.req.json());
    const data = await service.rotateGitLabConnectorToken(c.req.param('id')!, input.token, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...getGitLabConnectorCapabilitiesRoute,
    middleware: requireGitLabOperation('connector.capabilities.get', [
      'integrations:gitlab:view',
      'integrations:gitlab:manage',
    ]),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const data = await service.getGitLabConnectorCapabilities(c.req.param('id')!);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  { ...testGitLabConnectorRoute, middleware: requireGitLabOperation('connector.test', 'integrations:gitlab:manage') },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const data = await service.testGitLabConnector(c.req.param('id')!, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  { ...syncGitLabConnectorRoute, middleware: requireGitLabOperation('connector.sync', 'integrations:gitlab:manage') },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const data = await service.syncGitLabConnector(c.req.param('id')!, user.id);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...searchGitLabAllowlistRoute,
    middleware: requireGitLabOperation('connector.allowlist.search', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const query = GitLabAllowlistSearchQuerySchema.parse(c.req.query());
    const data = await service.searchGitLabAllowlist(c.req.param('id')!, query.q);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...listGitLabAllowlistOptionsRoute,
    middleware: requireGitLabOperation('connector.allowlist.options', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const data = await service.listGitLabAllowlistOptions(c.req.param('id')!);
    return c.json({ data });
  }
);

integrationsRoutes.openapi(
  {
    ...refreshGitLabAllowlistOptionsRoute,
    middleware: requireGitLabOperation('connector.allowlist.options.refresh', 'integrations:gitlab:manage'),
  },
  async (c) => {
    const service = container.resolve(IntegrationsService);
    const user = c.get('user')!;
    const data = await service.refreshGitLabAllowlistOptions(c.req.param('id')!, user.id);
    return c.json({ data });
  }
);
