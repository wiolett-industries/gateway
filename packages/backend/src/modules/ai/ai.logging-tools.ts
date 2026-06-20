import { container } from '@/container.js';
import { getResourceScopedIds, hasScope, hasScopeBase, hasScopeForResource } from '@/lib/permissions.js';
import {
  CreateLoggingEnvironmentSchema,
  CreateLoggingSchemaSchema,
  CreateLoggingTokenSchema,
  LoggingFacetsQuerySchema,
  LoggingSearchSchema,
  UpdateLoggingEnvironmentSchema,
  UpdateLoggingSchemaSchema,
} from '@/modules/logging/logging.schemas.js';
import type { User } from '@/types.js';

export async function manageLoggingTool(user: User, args: Record<string, unknown>) {
  const resource = String(args.resource);
  const operation = String(args.operation);
  const payload = (args.payload && typeof args.payload === 'object' ? args.payload : {}) as Record<string, unknown>;
  if (resource === 'environment') {
    const { LoggingEnvironmentService } = await import('@/modules/logging/logging-environment.service.js');
    const service = container.resolve(LoggingEnvironmentService);
    const id = String(args.environmentId ?? '');
    if (operation === 'list') {
      ensureLoggingScope(user, 'logs:environments:view');
      const allowedIds =
        hasScope(user.scopes, 'logs:manage') || hasScope(user.scopes, 'logs:environments:view')
          ? undefined
          : getResourceScopedIds(user.scopes, 'logs:environments:view');
      return service.list({
        search: typeof args.search === 'string' ? args.search : undefined,
        allowedIds,
      });
    }
    if (operation === 'get') {
      ensureLoggingScope(user, 'logs:environments:view', id);
      return service.get(id);
    }
    if (operation === 'create') {
      ensureLoggingScope(user, 'logs:environments:create');
      return service.create(CreateLoggingEnvironmentSchema.parse(payload), user.id);
    }
    if (operation === 'update') {
      ensureLoggingScope(user, 'logs:environments:edit', id);
      return service.update(id, UpdateLoggingEnvironmentSchema.parse(payload), user.id);
    }
    if (operation === 'delete') {
      ensureLoggingScope(user, 'logs:environments:delete', id);
      await service.delete(id, user.id);
      return { success: true };
    }
  }
  if (resource === 'schema') {
    const { LoggingSchemaService } = await import('@/modules/logging/logging-schema.service.js');
    const service = container.resolve(LoggingSchemaService);
    const id = String(args.schemaId ?? '');
    if (operation === 'list') {
      ensureLoggingScope(user, 'logs:schemas:view');
      const schemas = await service.list({ search: typeof args.search === 'string' ? args.search : undefined });
      if (hasScope(user.scopes, 'logs:manage') || hasScope(user.scopes, 'logs:schemas:view')) return schemas;
      const allowedIds = new Set(getResourceScopedIds(user.scopes, 'logs:schemas:view'));
      return schemas.filter((schema) => allowedIds.has(schema.id));
    }
    if (operation === 'get') {
      ensureLoggingScope(user, 'logs:schemas:view', id);
      return service.get(id);
    }
    if (operation === 'create') {
      ensureLoggingScope(user, 'logs:schemas:create');
      return service.create(CreateLoggingSchemaSchema.parse(payload), user.id);
    }
    if (operation === 'update') {
      ensureLoggingScope(user, 'logs:schemas:edit', id);
      return service.update(id, UpdateLoggingSchemaSchema.parse(payload), user.id);
    }
    if (operation === 'delete') {
      ensureLoggingScope(user, 'logs:schemas:delete', id);
      await service.delete(id, user.id);
      return { success: true };
    }
  }
  if (resource === 'token') {
    const { LoggingTokenService } = await import('@/modules/logging/logging-token.service.js');
    const service = container.resolve(LoggingTokenService);
    const environmentId = String(args.environmentId ?? '');
    ensureLoggingScope(
      user,
      operation === 'list' ? 'logs:tokens:view' : operation === 'create' ? 'logs:tokens:create' : 'logs:tokens:delete',
      environmentId
    );
    if (operation === 'list') return service.list(environmentId);
    if (operation === 'create') return service.create(environmentId, CreateLoggingTokenSchema.parse(payload), user.id);
    if (operation === 'delete') {
      await service.delete(environmentId, String(args.tokenId), user.id);
      return { success: true };
    }
  }
  if (resource === 'logs' && operation === 'search') {
    ensureLoggingScope(user, 'logs:read', String(args.environmentId));
    const { LoggingFeatureService } = await import('@/modules/logging/logging-feature.service.js');
    container.resolve(LoggingFeatureService).requireAvailableForStorage();
    const { LoggingSearchService } = await import('@/modules/logging/logging-search.service.js');
    return container
      .resolve(LoggingSearchService)
      .search(String(args.environmentId), LoggingSearchSchema.parse(payload) as any);
  }
  if (resource === 'facets' || operation === 'facets') {
    ensureLoggingScope(user, 'logs:read', String(args.environmentId));
    const { LoggingFeatureService } = await import('@/modules/logging/logging-feature.service.js');
    container.resolve(LoggingFeatureService).requireAvailableForStorage();
    const { LoggingSearchService } = await import('@/modules/logging/logging-search.service.js');
    return container
      .resolve(LoggingSearchService)
      .facets(String(args.environmentId), LoggingFacetsQuerySchema.parse(payload));
  }
  if (resource === 'metadata' || operation === 'metadata') {
    ensureLoggingScope(user, 'logs:read', String(args.environmentId));
    const { LoggingMetadataService } = await import('@/modules/logging/logging-metadata.service.js');
    return container.resolve(LoggingMetadataService).get(String(args.environmentId));
  }
  throw new Error(`Unsupported logging operation: ${resource}.${operation}`);
}

function ensureLoggingScope(user: User, baseScope: string, resourceId?: string) {
  if (hasScope(user.scopes, 'logs:manage')) return;
  if (resourceId ? hasScopeForResource(user.scopes, baseScope, resourceId) : hasScopeBase(user.scopes, baseScope)) {
    return;
  }
  throw new Error(`PERMISSION_DENIED: Missing required scope ${resourceId ? `${baseScope}:${resourceId}` : baseScope}`);
}
