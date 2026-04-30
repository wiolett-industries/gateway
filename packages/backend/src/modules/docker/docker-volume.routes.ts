import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { createVolumeRoute, listVolumesRoute, removeVolumeRoute } from './docker.docs.js';
import { VolumeCreateSchema } from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';

const DOCKER_RESOURCE_LIST_MAX = 1000;
const DOCKER_VOLUME_USED_BY_PREVIEW_MAX = 100;

function compactVolumeListItem(volume: Record<string, any>) {
  const usedBy = volume.usedBy ?? volume.UsedBy;
  return {
    name: volume.name ?? volume.Name,
    driver: volume.driver ?? volume.Driver,
    mountpoint: volume.mountpoint ?? volume.Mountpoint,
    scope: volume.scope ?? volume.Scope,
    createdAt: volume.createdAt ?? volume.CreatedAt,
    usedBy: Array.isArray(usedBy) ? usedBy.slice(0, DOCKER_VOLUME_USED_BY_PREVIEW_MAX) : usedBy,
    usedByCount: Array.isArray(usedBy) ? usedBy.length : undefined,
    usedByTruncated: Array.isArray(usedBy) && usedBy.length > DOCKER_VOLUME_USED_BY_PREVIEW_MAX,
  };
}

function matchesVolumeSearch(volume: Record<string, any>, search: string | undefined) {
  if (!search) return true;
  const usedBy = volume.usedBy ?? volume.UsedBy;
  const haystack = [
    volume.name ?? volume.Name,
    volume.driver ?? volume.Driver,
    volume.mountpoint ?? volume.Mountpoint,
    volume.scope ?? volume.Scope,
    ...(Array.isArray(usedBy) ? usedBy : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search);
}

export function registerVolumeRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Volume routes ───────────────────────────────────────────────────

  // List volumes
  router.openapi(
    { ...listVolumesRoute, middleware: requireScopeForResource('docker:volumes:list', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const data = await service.listVolumes(nodeId);
      if (!Array.isArray(data)) return c.json({ data });
      const search = c.req.query('search')?.trim().toLowerCase();
      const compacted = data
        .filter((item) => matchesVolumeSearch(item, search))
        .map((item) => compactVolumeListItem(item));
      const truncated = compacted.length > DOCKER_RESOURCE_LIST_MAX;
      return c.json({
        data: truncated ? compacted.slice(0, DOCKER_RESOURCE_LIST_MAX) : compacted,
        total: compacted.length,
        limit: DOCKER_RESOURCE_LIST_MAX,
        truncated,
      });
    }
  );

  // Create volume
  router.openapi(
    { ...createVolumeRoute, middleware: requireScopeForResource('docker:volumes:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = VolumeCreateSchema.parse(body);
      const data = await service.createVolume(nodeId, config, user.id);
      return c.json({ data }, 201);
    }
  );

  // Remove volume
  router.openapi(
    { ...removeVolumeRoute, middleware: requireScopeForResource('docker:volumes:delete', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const user = c.get('user')!;
      const force = c.req.query('force') === 'true';
      await service.removeVolume(nodeId, name, force, user.id);
      return c.json({ success: true });
    }
  );
}
