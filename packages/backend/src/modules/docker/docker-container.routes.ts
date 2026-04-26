import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  ContainerCreateSchema,
  ContainerDuplicateSchema,
  ContainerKillSchema,
  ContainerLiveUpdateSchema,
  ContainerRecreateSchema,
  ContainerRenameSchema,
  ContainerStopSchema,
  ContainerUpdateSchema,
  EnvUpdateSchema,
  FileBrowseSchema,
  FileWriteSchema,
  LogQuerySchema,
  SecretCreateSchema,
  SecretUpdateSchema,
} from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';
import { DockerSecretService } from './docker-secret.service.js';

const DOCKER_DEPLOYMENT_MANAGED_LABEL = 'wiolett.gateway.deployment.managed';

/** Resolve container name from container ID via inspect */
async function resolveContainerName(nodeId: string, containerId: string): Promise<string> {
  const dockerService = container.resolve(DockerManagementService);
  const inspect = await dockerService.inspectContainer(nodeId, containerId);
  const labels = inspect?.Config?.Labels ?? {};
  if (labels?.[DOCKER_DEPLOYMENT_MANAGED_LABEL] === 'true') {
    throw new AppError(
      409,
      'MANAGED_DEPLOYMENT_CONTAINER',
      'This container is managed by a blue/green deployment. Use deployment actions instead.'
    );
  }
  const name = (inspect?.Name ?? '').replace(/^\//, '');
  if (!name) throw new Error('Could not resolve container name');
  return name;
}

export function registerContainerRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Container routes ────────────────────────────────────────────────

  // List containers
  router.get('/nodes/:nodeId/containers', requireScopeForResource('docker:containers:list', 'nodeId'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const data = await service.listContainers(nodeId);
    return c.json({ data });
  });

  // Create container
  router.post('/nodes/:nodeId/containers', requireScopeForResource('docker:containers:create', 'nodeId'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const config = ContainerCreateSchema.parse(body);
    const data = await service.createContainer(nodeId, config, user.id);
    return c.json({ data }, 201);
  });

  // Inspect container
  router.get(
    '/nodes/:nodeId/containers/:containerId',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const data = await service.inspectContainer(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Start container
  router.post(
    '/nodes/:nodeId/containers/:containerId/start',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      await service.startContainer(nodeId, containerId, user.id);
      return c.json({ success: true });
    }
  );

  // Stop container
  router.post(
    '/nodes/:nodeId/containers/:containerId/stop',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { timeout } = ContainerStopSchema.parse(body);
      await service.stopContainer(nodeId, containerId, timeout, user.id);
      return c.json({ success: true });
    }
  );

  // Restart container
  router.post(
    '/nodes/:nodeId/containers/:containerId/restart',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { timeout } = ContainerStopSchema.parse(body);
      await service.restartContainer(nodeId, containerId, timeout, user.id);
      return c.json({ success: true });
    }
  );

  // Kill container
  router.post(
    '/nodes/:nodeId/containers/:containerId/kill',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { signal } = ContainerKillSchema.parse(body);
      await service.killContainer(nodeId, containerId, signal, user.id);
      return c.json({ success: true });
    }
  );

  // Remove container
  router.delete(
    '/nodes/:nodeId/containers/:containerId',
    requireScopeForResource('docker:containers:delete', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const force = c.req.query('force') === 'true';
      await service.removeContainer(nodeId, containerId, force, user.id);
      return c.json({ success: true });
    }
  );

  // Rename container
  router.post(
    '/nodes/:nodeId/containers/:containerId/rename',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const { name } = ContainerRenameSchema.parse(body);
      await service.renameContainer(nodeId, containerId, name, user.id);
      return c.json({ success: true });
    }
  );

  // Duplicate container
  router.post(
    '/nodes/:nodeId/containers/:containerId/duplicate',
    requireScopeForResource('docker:containers:create', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const { name } = ContainerDuplicateSchema.parse(body);
      const data = await service.duplicateContainer(nodeId, containerId, name, user.id);
      return c.json({ data }, 201);
    }
  );

  // Update container (pull + redeploy)
  router.post(
    '/nodes/:nodeId/containers/:containerId/update',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerUpdateSchema.parse(body);
      const data = await service.updateContainer(nodeId, containerId, config, user.id);
      return c.json({ data });
    }
  );

  // Live update container (no recreation — resource limits + restart policy)
  router.post(
    '/nodes/:nodeId/containers/:containerId/live-update',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerLiveUpdateSchema.parse(body);
      await service.liveUpdateContainer(nodeId, containerId, config, user.id);
      return c.json({ success: true });
    }
  );

  // Recreate container with new config (ports, mounts, entrypoint, etc.)
  router.post(
    '/nodes/:nodeId/containers/:containerId/recreate',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerRecreateSchema.parse(body);
      const data = await service.recreateWithConfig(nodeId, containerId, config, user.id);
      return c.json({ data });
    }
  );

  // Container logs
  router.get(
    '/nodes/:nodeId/containers/:containerId/logs',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const rawQuery = c.req.query();
      const { tail, timestamps } = LogQuerySchema.parse(rawQuery);
      const data = await service.getContainerLogs(nodeId, containerId, tail, timestamps);
      return c.json({ data });
    }
  );

  // Container stats (live one-shot)
  router.get(
    '/nodes/:nodeId/containers/:containerId/stats',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const data = await service.getContainerStats(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Container stats history (for sparklines)
  router.get(
    '/nodes/:nodeId/containers/:containerId/stats/history',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const { NodeMonitoringService } = await import('@/modules/nodes/node-monitoring.service.js');
      const monitoring = container.resolve(NodeMonitoringService);
      const containerId = c.req.param('containerId');
      const data = await monitoring.getContainerStatsHistory(containerId);
      return c.json({ data });
    }
  );

  // Container top (process list)
  router.get(
    '/nodes/:nodeId/containers/:containerId/top',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const data = await service.getContainerTop(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Get container env
  router.get(
    '/nodes/:nodeId/containers/:containerId/env',
    requireScopeForResource('docker:containers:environment', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const data = await service.getContainerEnv(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Update container env
  router.put(
    '/nodes/:nodeId/containers/:containerId/env',
    requireScopeForResource('docker:containers:environment', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const { env, removeEnv } = EnvUpdateSchema.parse(body);
      const data = await service.updateContainerEnv(nodeId, containerId, env, removeEnv, user.id);
      return c.json({ data });
    }
  );

  // ─── Secret routes ────────────────────────────────────────────────────

  // List secrets (values masked unless user has docker:containers:secrets scope)
  router.get(
    '/nodes/:nodeId/containers/:containerId/secrets',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const containerName = await resolveContainerName(nodeId, containerId);
      const scopes = c.get('effectiveScopes') || [];
      const canReveal = TokensService.hasScope(scopes, `docker:containers:secrets:${nodeId}`);
      const data = await service.list(nodeId, containerName, canReveal);
      return c.json({ data });
    }
  );

  // Create secret
  router.post(
    '/nodes/:nodeId/containers/:containerId/secrets',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const containerName = await resolveContainerName(nodeId, containerId);
      const user = c.get('user')!;
      const body = await c.req.json();
      const { key, value } = SecretCreateSchema.parse(body);
      const data = await service.create(nodeId, containerName, key, value, user.id);
      return c.json({ data }, 201);
    }
  );

  // Update secret
  router.put(
    '/nodes/:nodeId/containers/:containerId/secrets/:secretId',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const secretId = c.req.param('secretId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const { value } = SecretUpdateSchema.parse(body);
      const data = await service.update(secretId, nodeId, value, user.id);
      return c.json({ data });
    }
  );

  // Delete secret
  router.delete(
    '/nodes/:nodeId/containers/:containerId/secrets/:secretId',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const secretId = c.req.param('secretId');
      const user = c.get('user')!;
      await service.delete(secretId, nodeId, user.id);
      return c.json({ success: true });
    }
  );

  // ─── File browser routes ─────────────────────────────────────────────

  // List directory
  router.get(
    '/nodes/:nodeId/containers/:containerId/files',
    requireScopeForResource('docker:containers:files', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const rawQuery = c.req.query();
      const { path } = FileBrowseSchema.parse(rawQuery);
      const data = await service.listDirectory(nodeId, containerId, path);
      return c.json({ data });
    }
  );

  // Read file
  router.get(
    '/nodes/:nodeId/containers/:containerId/files/read',
    requireScopeForResource('docker:containers:files', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const rawQuery = c.req.query();
      const { path } = FileBrowseSchema.parse(rawQuery);
      const data = await service.readFile(nodeId, containerId, path);
      return c.json({ data });
    }
  );

  // Write file
  router.put(
    '/nodes/:nodeId/containers/:containerId/files/write',
    requireScopeForResource('docker:containers:files', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId');
      const containerId = c.req.param('containerId');
      const user = c.get('user')!;
      const body = await c.req.json();
      const { path, content } = FileWriteSchema.parse(body);
      await service.writeFile(nodeId, containerId, path, content, user.id);
      return c.json({ success: true });
    }
  );
}
