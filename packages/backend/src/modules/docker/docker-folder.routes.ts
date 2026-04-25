import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AppEnv } from '@/types.js';
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
  router.get('/folders', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(scopes, 'docker:containers:list', 'Docker folders require docker:containers:list scope');
    const service = container.resolve(DockerFolderService);
    const data = await service.getFolderTree();
    return c.json({ data });
  });

  router.post('/folders', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(scopes, 'docker:containers:edit', 'Creating Docker folders requires docker:containers:edit');
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = CreateDockerFolderSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    const data = await service.createFolder(input, user.id);
    return c.json({ data }, 201);
  });

  router.put('/folders/reorder', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(
      scopes,
      'docker:containers:edit',
      'Reordering Docker folders requires docker:containers:edit'
    );
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = ReorderDockerFoldersSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    await service.reorderFolders(input, user.id);
    return c.json({ success: true });
  });

  router.put('/folders/reorder-containers', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
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

  router.put('/folders/:id', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(scopes, 'docker:containers:edit', 'Updating Docker folders requires docker:containers:edit');
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = UpdateDockerFolderSchema.parse(body);
    const service = container.resolve(DockerFolderService);
    const data = await service.updateFolder(c.req.param('id'), input, user.id);
    return c.json({ data });
  });

  router.delete('/folders/:id', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
    requireAnyDockerScope(scopes, 'docker:containers:edit', 'Deleting Docker folders requires docker:containers:edit');
    const user = c.get('user')!;
    const service = container.resolve(DockerFolderService);
    await service.deleteFolder(c.req.param('id'), user.id);
    return c.body(null, 204);
  });

  router.post('/folders/move-containers', async (c) => {
    const scopes = c.get('effectiveScopes') || [];
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
