import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AppError } from '@/middleware/error-handler.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  containerEnvRoute,
  containerLogsRoute,
  containerStatsHistoryRoute,
  containerStatsRoute,
  containerTopRoute,
  createContainerRoute,
  createContainerSecretRoute,
  deleteContainerSecretRoute,
  duplicateContainerRoute,
  inspectContainerRoute,
  killContainerRoute,
  listContainerFilesRoute,
  listContainerSecretsRoute,
  listContainersRoute,
  liveUpdateContainerRoute,
  readContainerFileRoute,
  recreateContainerRoute,
  removeContainerRoute,
  renameContainerRoute,
  restartContainerRoute,
  startContainerRoute,
  stopContainerRoute,
  updateContainerEnvRoute,
  updateContainerRoute,
  updateContainerSecretRoute,
  writeContainerFileRoute,
} from './docker.docs.js';
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
const DOCKER_RESOURCE_LIST_MAX = 1000;
const DOCKER_CONTAINER_PORT_PREVIEW_MAX = 64;

function compactContainerListItem(container: Record<string, any>) {
  const ports = container.ports ?? container.Ports;
  return {
    id: container.id ?? container.Id,
    name: ((container.name ?? container.Name ?? '') as string).replace(/^\//, ''),
    image: container.image ?? container.Image,
    state: container.state ?? container.State,
    status: container.status ?? container.Status,
    created: container.created ?? container.Created,
    ports: Array.isArray(ports) ? ports.slice(0, DOCKER_CONTAINER_PORT_PREVIEW_MAX) : ports,
    portsCount: Array.isArray(ports) ? ports.length : undefined,
    portsTruncated: Array.isArray(ports) && ports.length > DOCKER_CONTAINER_PORT_PREVIEW_MAX,
    kind: container.kind ?? 'container',
    deploymentId: container.deploymentId,
    activeSlot: container.activeSlot,
    primaryRoute: container.primaryRoute,
    activeSlotContainerId: container.activeSlotContainerId,
    healthCheckId: container.healthCheckId,
    healthCheckEnabled: container.healthCheckEnabled,
    healthStatus: container.healthStatus,
    lastHealthCheckAt: container.lastHealthCheckAt,
    folderId: container.folderId,
    folderIsSystem: container.folderIsSystem,
    folderSortOrder: container.folderSortOrder,
    _transition: container._transition,
  };
}

function matchesContainerSearch(container: Record<string, any>, search: string | undefined) {
  if (!search) return true;
  const ports = container.ports ?? container.Ports;
  const portText = Array.isArray(ports)
    ? ports.map((port: any) => [port.ip, port.publicPort, port.privatePort, port.type].join(' ')).join(' ')
    : '';
  const haystack = [
    container.id ?? container.Id,
    container.name ?? container.Name,
    container.image ?? container.Image,
    container.state ?? container.State,
    container.status ?? container.Status,
    container.kind,
    container.deploymentId,
    container.activeSlot,
    portText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search);
}

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
  router.openapi(
    { ...listContainersRoute, middleware: requireScopeForResource('docker:containers:list', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const data = await service.listContainers(nodeId);
      if (!Array.isArray(data)) return c.json({ data });
      const search = c.req.query('search')?.trim().toLowerCase();
      const compacted = data
        .filter((item) => matchesContainerSearch(item, search))
        .map((item) => compactContainerListItem(item));
      const truncated = compacted.length > DOCKER_RESOURCE_LIST_MAX;
      return c.json({
        data: truncated ? compacted.slice(0, DOCKER_RESOURCE_LIST_MAX) : compacted,
        total: compacted.length,
        limit: DOCKER_RESOURCE_LIST_MAX,
        truncated,
      });
    }
  );

  // Create container
  router.openapi(
    { ...createContainerRoute, middleware: requireScopeForResource('docker:containers:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerCreateSchema.parse(body);
      const data = await service.createContainer(nodeId, config, user.id, c.get('effectiveScopes') || []);
      return c.json({ data }, 201);
    }
  );

  // Inspect container
  router.openapi(
    { ...inspectContainerRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const data = await service.inspectContainer(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Start container
  router.openapi(
    { ...startContainerRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      await service.startContainer(nodeId, containerId, user.id);
      return c.json({ success: true });
    }
  );

  // Stop container
  router.openapi(
    { ...stopContainerRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { timeout } = ContainerStopSchema.parse(body);
      await service.stopContainer(nodeId, containerId, timeout, user.id);
      return c.json({ success: true });
    }
  );

  // Restart container
  router.openapi(
    { ...restartContainerRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { timeout } = ContainerStopSchema.parse(body);
      await service.restartContainer(nodeId, containerId, timeout, user.id);
      return c.json({ success: true });
    }
  );

  // Kill container
  router.openapi(
    { ...killContainerRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const { signal } = ContainerKillSchema.parse(body);
      await service.killContainer(nodeId, containerId, signal, user.id);
      return c.json({ success: true });
    }
  );

  // Remove container
  router.openapi(
    { ...removeContainerRoute, middleware: requireScopeForResource('docker:containers:delete', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const force = c.req.query('force') === 'true';
      await service.removeContainer(nodeId, containerId, force, user.id);
      return c.json({ success: true });
    }
  );

  // Rename container
  router.openapi(
    { ...renameContainerRoute, middleware: requireScopeForResource('docker:containers:edit', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const { name } = ContainerRenameSchema.parse(body);
      await service.renameContainer(nodeId, containerId, name, user.id);
      return c.json({ success: true });
    }
  );

  // Duplicate container
  router.openapi(
    { ...duplicateContainerRoute, middleware: requireScopeForResource('docker:containers:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const { name } = ContainerDuplicateSchema.parse(body);
      const data = await service.duplicateContainer(nodeId, containerId, name, user.id, c.get('effectiveScopes') || []);
      return c.json({ data }, 201);
    }
  );

  // Update container (pull + redeploy)
  router.openapi(
    { ...updateContainerRoute, middleware: requireScopeForResource('docker:containers:edit', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerUpdateSchema.parse(body);
      const data = await service.updateContainer(nodeId, containerId, config, user.id, c.get('effectiveScopes') || []);
      return c.json({ data });
    }
  );

  // Live update container (no recreation — resource limits + restart policy)
  router.openapi(
    { ...liveUpdateContainerRoute, middleware: requireScopeForResource('docker:containers:edit', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerLiveUpdateSchema.parse(body);
      await service.liveUpdateContainer(nodeId, containerId, config, user.id);
      return c.json({ success: true });
    }
  );

  // Recreate container with new config (ports, mounts, entrypoint, etc.)
  router.openapi(
    { ...recreateContainerRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const config = ContainerRecreateSchema.parse(body);
      const data = await service.recreateWithConfig(nodeId, containerId, config, user.id, {
        actorScopes: c.get('effectiveScopes') || [],
      });
      return c.json({ data });
    }
  );

  // Container logs
  router.openapi(
    { ...containerLogsRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const rawQuery = c.req.query();
      const { tail, timestamps } = LogQuerySchema.parse(rawQuery);
      const data = await service.getContainerLogs(nodeId, containerId, tail, timestamps);
      return c.json({ data });
    }
  );

  // Container stats (live one-shot)
  router.openapi(
    { ...containerStatsRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const data = await service.getContainerStats(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Container stats history (for sparklines)
  router.openapi(
    { ...containerStatsHistoryRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const { NodeMonitoringService } = await import('@/modules/nodes/node-monitoring.service.js');
      const monitoring = container.resolve(NodeMonitoringService);
      const containerId = c.req.param('containerId')!;
      const data = await monitoring.getContainerStatsHistory(containerId);
      return c.json({ data });
    }
  );

  // Container top (process list)
  router.openapi(
    { ...containerTopRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const data = await service.getContainerTop(nodeId, containerId);
      if (Array.isArray(data?.Processes) && data.Processes.length > DOCKER_RESOURCE_LIST_MAX) {
        return c.json({
          data: {
            ...data,
            Processes: data.Processes.slice(0, DOCKER_RESOURCE_LIST_MAX),
            totalProcesses: data.Processes.length,
            limit: DOCKER_RESOURCE_LIST_MAX,
            truncated: true,
          },
          truncated: true,
        });
      }
      return c.json({ data });
    }
  );

  // Get container env
  router.openapi(
    { ...containerEnvRoute, middleware: requireScopeForResource('docker:containers:environment', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const data = await service.getContainerEnv(nodeId, containerId);
      return c.json({ data });
    }
  );

  // Update container env
  router.openapi(
    { ...updateContainerEnvRoute, middleware: requireScopeForResource('docker:containers:environment', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const { env, removeEnv } = EnvUpdateSchema.parse(body);
      const data = await service.updateContainerEnv(nodeId, containerId, env, removeEnv, user.id);
      return c.json({ data });
    }
  );

  // ─── Secret routes ────────────────────────────────────────────────────

  // List secrets (values masked unless user has docker:containers:secrets scope)
  router.openapi(
    { ...listContainerSecretsRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const containerName = await resolveContainerName(nodeId, containerId);
      const scopes = c.get('effectiveScopes') || [];
      const canReveal = TokensService.hasScope(scopes, `docker:containers:secrets:${nodeId}`);
      const data = await service.list(nodeId, containerName, canReveal);
      return c.json({ data });
    }
  );

  // Create secret
  router.openapi(
    { ...createContainerSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const containerName = await resolveContainerName(nodeId, containerId);
      const user = c.get('user')!;
      const body = await c.req.json();
      const { key, value } = SecretCreateSchema.parse(body);
      const data = await service.create(nodeId, containerName, key, value, user.id);
      return c.json({ data }, 201);
    }
  );

  // Update secret
  router.openapi(
    { ...updateContainerSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const secretId = c.req.param('secretId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const { value } = SecretUpdateSchema.parse(body);
      const data = await service.update(secretId, nodeId, value, user.id);
      return c.json({ data });
    }
  );

  // Delete secret
  router.openapi(
    { ...deleteContainerSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const secretId = c.req.param('secretId')!;
      const user = c.get('user')!;
      await service.delete(secretId, nodeId, user.id);
      return c.json({ success: true });
    }
  );

  // ─── File browser routes ─────────────────────────────────────────────

  // List directory
  router.openapi(
    { ...listContainerFilesRoute, middleware: requireScopeForResource('docker:containers:files', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const rawQuery = c.req.query();
      const { path } = FileBrowseSchema.parse(rawQuery);
      const data = await service.listDirectory(nodeId, containerId, path);
      const truncated = Array.isArray(data) && data.length > DOCKER_RESOURCE_LIST_MAX;
      return c.json({
        data: truncated ? data.slice(0, DOCKER_RESOURCE_LIST_MAX) : data,
        total: Array.isArray(data) ? data.length : undefined,
        limit: DOCKER_RESOURCE_LIST_MAX,
        truncated,
      });
    }
  );

  // Read file
  router.openapi(
    { ...readContainerFileRoute, middleware: requireScopeForResource('docker:containers:files', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const rawQuery = c.req.query();
      const { path } = FileBrowseSchema.parse(rawQuery);
      const data = await service.readFile(nodeId, containerId, path);
      return c.json({ data });
    }
  );

  // Write file
  router.openapi(
    { ...writeContainerFileRoute, middleware: requireScopeForResource('docker:containers:files', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerManagementService);
      const nodeId = c.req.param('nodeId')!;
      const containerId = c.req.param('containerId')!;
      const user = c.get('user')!;
      const body = await c.req.json();
      const { path, content } = FileWriteSchema.parse(body);
      await service.writeFile(nodeId, containerId, path, content, user.id);
      return c.json({ success: true });
    }
  );
}
