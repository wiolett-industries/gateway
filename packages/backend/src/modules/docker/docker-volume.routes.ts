import type { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { container } from '@/container.js';
import { sanitizeFilename } from '@/lib/utils.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  createVolumeRoute,
  exportVolumeRoute,
  inspectVolumeRoute,
  listVolumeFilesRoute,
  listVolumesRoute,
  removeVolumeRoute,
  renameVolumeRoute,
  updateVolumeLabelsRoute,
} from './docker.docs.js';
import {
  FileBrowseSchema,
  VolumeCreateSchema,
  VolumeLabelsUpdateSchema,
  VolumeRenameSchema,
} from './docker.schemas.js';
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

function normalizeVolumeDetailItem(volume: Record<string, any>) {
  const usedBy = volume.usedBy ?? volume.UsedBy;
  const normalizedUsedBy = Array.isArray(usedBy) ? usedBy : [];
  return {
    name: volume.name ?? volume.Name,
    driver: volume.driver ?? volume.Driver,
    mountpoint: volume.mountpoint ?? volume.Mountpoint,
    labels: volume.labels ?? volume.Labels ?? {},
    scope: volume.scope ?? volume.Scope,
    createdAt: volume.createdAt ?? volume.CreatedAt,
    usedBy: normalizedUsedBy,
    usedByCount: normalizedUsedBy.length,
    usedByTruncated: false,
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
    { ...listVolumesRoute, middleware: requireScopeForResource('docker:volumes:view', 'nodeId') },
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

  // Inspect volume
  router.openapi(
    { ...inspectVolumeRoute, middleware: requireScopeForResource('docker:volumes:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const data = await service.inspectVolume(nodeId, name);
      return c.json({ data: normalizeVolumeDetailItem(data) });
    }
  );

  // List volume files
  router.openapi(
    { ...listVolumeFilesRoute, middleware: requireScopeForResource('docker:volumes:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams.entries());
      const { path } = FileBrowseSchema.parse(rawQuery);
      const data = await service.listVolumeFiles(nodeId, name, path);
      return c.json({ data });
    }
  );

  // Export volume
  router.openapi(
    { ...exportVolumeRoute, middleware: requireScopeForResource('docker:volumes:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const data = await service.exportVolume(nodeId, name);
      return new Response(data, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(name)}.tar.gz"`,
        },
      });
    }
  );

  // Rename volume
  router.openapi(
    { ...renameVolumeRoute, middleware: requireScopeForResource('docker:volumes:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const user = c.get('user')!;
      const scopes = c.get('effectiveScopes') ?? [];
      if (!TokensService.hasScope(scopes, `docker:volumes:delete:${nodeId}`)) {
        throw new HTTPException(403, { message: `Missing required scope: docker:volumes:delete:${nodeId}` });
      }
      const body = await c.req.json();
      const { name: newName } = VolumeRenameSchema.parse(body);
      await service.renameVolume(nodeId, name, newName, user.id);
      return c.json({ success: true });
    }
  );

  // Update volume labels
  router.openapi(
    { ...updateVolumeLabelsRoute, middleware: requireScopeForResource('docker:volumes:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const name = c.req.param('name')!;
      const user = c.get('user')!;
      const scopes = c.get('effectiveScopes') ?? [];
      if (!TokensService.hasScope(scopes, `docker:volumes:delete:${nodeId}`)) {
        throw new HTTPException(403, { message: `Missing required scope: docker:volumes:delete:${nodeId}` });
      }
      const body = await c.req.json();
      const { labels } = VolumeLabelsUpdateSchema.parse(body);
      await service.updateVolumeLabels(nodeId, name, labels, user.id);
      return c.json({ success: true });
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
