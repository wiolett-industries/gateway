import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { getResourceScopedIds, hasScope, hasScopeBase } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AppEnv } from '@/types.js';
import {
  createDockerFolderRoute,
  deleteDockerFolderRoute,
  listDockerFoldersRoute,
  moveDockerContainersRoute,
  reorderDockerContainersRoute,
  reorderDockerFoldersRoute,
  updateDockerFolderRoute,
} from './docker.docs.js';
import {
  CreateDockerFolderSchema,
  MoveDockerContainersToFolderSchema,
  ReorderDockerContainersSchema,
  ReorderDockerFoldersSchema,
  UpdateDockerFolderSchema,
} from './docker-folder.schemas.js';
import { DockerFolderService } from './docker-folder.service.js';

function hasAnyDockerScope(scopes: string[], prefix: string): boolean {
  return scopes.some((scope) => scope === prefix || scope.startsWith(`${prefix}:`));
}

function requireAnyDockerScope(scopes: string[], prefix: string, message: string) {
  if (!hasAnyDockerScope(scopes, prefix)) {
    throw new AppError(403, 'FORBIDDEN', message);
  }
}

export function registerDockerFolderRoutes(router: OpenAPIHono<AppEnv>) {
  router.openapi(listDockerFoldersRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    if (!hasScopeBase(scopes, 'docker:containers:view') && !hasScope(scopes, 'docker:containers:folders:manage')) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Docker folders require docker:containers:view or docker:containers:folders:manage'
      );
    }
    const service = container.resolve(DockerFolderService);
    const canManageFolders = hasScope(scopes, 'docker:containers:folders:manage');
    const data = await service.getFolderTree(
      canManageFolders || hasScope(scopes, 'docker:containers:view')
        ? { includeAllFolders: canManageFolders }
        : { allowedNodeIds: getResourceScopedIds(scopes, 'docker:containers:view') }
    );
    return c.json({ data });
  });

  router.openapi(createDockerFolderRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Creating Docker folders requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = CreateDockerFolderSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    const data = await service.createFolder(input, user.id);
    return c.json({ data }, 201);
  });

  router.openapi(reorderDockerFoldersRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Reordering Docker folders requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = ReorderDockerFoldersSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    await service.reorderFolders(input, user.id);
    return c.json({ success: true });
  });

  router.openapi(reorderDockerContainersRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Reordering Docker containers requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = ReorderDockerContainersSchema.parse(body);
    for (const item of input.items) {
      if (!hasScope(scopes, `docker:containers:edit:${item.nodeId}`)) {
        throw new AppError(403, 'FORBIDDEN', 'Reordering containers requires docker:containers:edit');
      }
    }
    const service = container.resolve(DockerFolderService);
    await service.reorderContainers(input, user.id);
    return c.json({ success: true });
  });

  router.openapi(updateDockerFolderRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Updating Docker folders requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = UpdateDockerFolderSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    const data = await service.updateFolder(c.req.param('id')!, input, user.id);
    return c.json({ data });
  });

  router.openapi(deleteDockerFolderRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Deleting Docker folders requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const service = container.resolve(DockerFolderService);
    await service.deleteFolder(c.req.param('id')!, user.id);
    return c.body(null, 204);
  });

  router.openapi(moveDockerContainersRoute, async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:folders:manage',
      'Moving containers between Docker folders requires docker:containers:folders:manage'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = MoveDockerContainersToFolderSchema.parse(body);
    for (const item of input.items) {
      if (!hasScope(scopes, `docker:containers:edit:${item.nodeId}`)) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Moving containers between Docker folders requires docker:containers:edit'
        );
      }
    }
    const service = container.resolve(DockerFolderService);
    await service.moveContainersToFolder(input, user.id);
    return c.json({ success: true });
  });
}
