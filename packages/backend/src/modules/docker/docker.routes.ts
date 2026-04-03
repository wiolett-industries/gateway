import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  ContainerCreateSchema,
  ContainerDuplicateSchema,
  ContainerKillSchema,
  ContainerRenameSchema,
  ContainerStopSchema,
  ContainerUpdateSchema,
  ContainerLiveUpdateSchema,
  ContainerRecreateSchema,
  EnvUpdateSchema,
  FileBrowseSchema,
  FileWriteSchema,
  ImagePullSchema,
  LogQuerySchema,
  NetworkConnectSchema,
  NetworkCreateSchema,
  RegistryCreateSchema,
  RegistryUpdateSchema,
  TemplateCreateSchema,
  TemplateDeploySchema,
  TemplateUpdateSchema,
  VolumeCreateSchema,
} from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';
import { DockerRegistryService } from './docker-registry.service.js';
import { DockerTaskService } from './docker-task.service.js';
import { DockerTemplateService } from './docker-template.service.js';

export const dockerRoutes = new OpenAPIHono<AppEnv>();

dockerRoutes.use('*', authMiddleware);
dockerRoutes.use('*', sessionOnly);

// ─── Container routes ────────────────────────────────────────────────

// List containers
dockerRoutes.get('/nodes/:nodeId/containers', requireScope('docker:list'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const data = await service.listContainers(nodeId);
  return c.json({ data });
});

// Create container
dockerRoutes.post('/nodes/:nodeId/containers', requireScope('docker:create'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = ContainerCreateSchema.parse(body);
  const data = await service.createContainer(nodeId, config, user.id);
  return c.json({ data }, 201);
});

// Inspect container
dockerRoutes.get('/nodes/:nodeId/containers/:containerId', requireScope('docker:view'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const data = await service.inspectContainer(nodeId, containerId);
  return c.json({ data });
});

// Start container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/start', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  await service.startContainer(nodeId, containerId, user.id);
  return c.json({ success: true });
});

// Stop container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/stop', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { timeout } = ContainerStopSchema.parse(body);
  await service.stopContainer(nodeId, containerId, timeout, user.id);
  return c.json({ success: true });
});

// Restart container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/restart', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { timeout } = ContainerStopSchema.parse(body);
  await service.restartContainer(nodeId, containerId, timeout, user.id);
  return c.json({ success: true });
});

// Kill container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/kill', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { signal } = ContainerKillSchema.parse(body);
  await service.killContainer(nodeId, containerId, signal, user.id);
  return c.json({ success: true });
});

// Remove container
dockerRoutes.delete('/nodes/:nodeId/containers/:containerId', requireScope('docker:delete'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const force = c.req.query('force') === 'true';
  await service.removeContainer(nodeId, containerId, force, user.id);
  return c.json({ success: true });
});

// Rename container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/rename', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { name } = ContainerRenameSchema.parse(body);
  await service.renameContainer(nodeId, containerId, name, user.id);
  return c.json({ success: true });
});

// Duplicate container
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/duplicate', requireScope('docker:create'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { name } = ContainerDuplicateSchema.parse(body);
  const data = await service.duplicateContainer(nodeId, containerId, name, user.id);
  return c.json({ data }, 201);
});

// Update container (pull + redeploy)
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/update', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = ContainerUpdateSchema.parse(body);
  const data = await service.updateContainer(nodeId, containerId, config, user.id);
  return c.json({ data });
});

// Live update container (no recreation — resource limits + restart policy)
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/live-update', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = ContainerLiveUpdateSchema.parse(body);
  await service.liveUpdateContainer(nodeId, containerId, config, user.id);
  return c.json({ success: true });
});

// Recreate container with new config (ports, mounts, entrypoint, etc.)
dockerRoutes.post('/nodes/:nodeId/containers/:containerId/recreate', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = ContainerRecreateSchema.parse(body);
  const data = await service.recreateWithConfig(nodeId, containerId, config, user.id);
  return c.json({ data });
});

// Container logs
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/logs', requireScope('docker:view'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const rawQuery = c.req.query();
  const { tail, timestamps } = LogQuerySchema.parse(rawQuery);
  const data = await service.getContainerLogs(nodeId, containerId, tail, timestamps);
  return c.json({ data });
});

// Container stats (live one-shot)
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/stats', requireScope('docker:view'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const data = await service.getContainerStats(nodeId, containerId);
  return c.json({ data });
});

// Container stats history (for sparklines)
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/stats/history', requireScope('docker:view'), async (c) => {
  const { NodeMonitoringService } = await import('@/modules/nodes/node-monitoring.service.js');
  const monitoring = container.resolve(NodeMonitoringService);
  const containerId = c.req.param('containerId');
  const data = await monitoring.getContainerStatsHistory(containerId);
  return c.json({ data });
});

// Container top (process list)
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/top', requireScope('docker:view'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const data = await service.getContainerTop(nodeId, containerId);
  return c.json({ data });
});

// Get container env
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/env', requireScope('docker:view'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const data = await service.getContainerEnv(nodeId, containerId);
  return c.json({ data });
});

// Update container env
dockerRoutes.put('/nodes/:nodeId/containers/:containerId/env', requireScope('docker:edit'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { env, removeEnv } = EnvUpdateSchema.parse(body);
  const data = await service.updateContainerEnv(nodeId, containerId, env, removeEnv, user.id);
  return c.json({ data });
});

// ─── File browser routes ─────────────────────────────────────────────

// List directory
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/files', requireScope('docker:files'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const rawQuery = c.req.query();
  const { path } = FileBrowseSchema.parse(rawQuery);
  const data = await service.listDirectory(nodeId, containerId, path);
  return c.json({ data });
});

// Read file
dockerRoutes.get('/nodes/:nodeId/containers/:containerId/files/read', requireScope('docker:files'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const rawQuery = c.req.query();
  const { path } = FileBrowseSchema.parse(rawQuery);
  const data = await service.readFile(nodeId, containerId, path);
  return c.json({ data });
});

// Write file
dockerRoutes.put('/nodes/:nodeId/containers/:containerId/files/write', requireScope('docker:files'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const containerId = c.req.param('containerId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { path, content } = FileWriteSchema.parse(body);
  await service.writeFile(nodeId, containerId, path, content, user.id);
  return c.json({ success: true });
});

// ─── Image routes ────────────────────────────────────────────────────

// List images
dockerRoutes.get('/nodes/:nodeId/images', requireScope('docker:images'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const data = await service.listImages(nodeId);
  return c.json({ data });
});

// Pull image
dockerRoutes.post('/nodes/:nodeId/images/pull', requireScope('docker:images'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { imageRef } = ImagePullSchema.parse(body);
  const data = await service.pullImage(nodeId, imageRef, undefined, user.id);
  return c.json({ data });
});

// Remove image
dockerRoutes.delete('/nodes/:nodeId/images/:imageId', requireScope('docker:images'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const imageId = c.req.param('imageId');
  const user = c.get('user')!;
  const force = c.req.query('force') === 'true';
  await service.removeImage(nodeId, imageId, force, user.id);
  return c.json({ success: true });
});

// Prune images
dockerRoutes.post('/nodes/:nodeId/images/prune', requireScope('docker:images'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const user = c.get('user')!;
  const data = await service.pruneImages(nodeId, user.id);
  return c.json({ data });
});

// ─── Volume routes ───────────────────────────────────────────────────

// List volumes
dockerRoutes.get('/nodes/:nodeId/volumes', requireScope('docker:volumes'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const data = await service.listVolumes(nodeId);
  return c.json({ data });
});

// Create volume
dockerRoutes.post('/nodes/:nodeId/volumes', requireScope('docker:volumes'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = VolumeCreateSchema.parse(body);
  const data = await service.createVolume(nodeId, config, user.id);
  return c.json({ data }, 201);
});

// Remove volume
dockerRoutes.delete('/nodes/:nodeId/volumes/:name', requireScope('docker:volumes'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const name = c.req.param('name');
  const user = c.get('user')!;
  const force = c.req.query('force') === 'true';
  await service.removeVolume(nodeId, name, force, user.id);
  return c.json({ success: true });
});

// ─── Network routes ──────────────────────────────────────────────────

// List networks
dockerRoutes.get('/nodes/:nodeId/networks', requireScope('docker:networks'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const data = await service.listNetworks(nodeId);
  return c.json({ data });
});

// Create network
dockerRoutes.post('/nodes/:nodeId/networks', requireScope('docker:networks'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const config = NetworkCreateSchema.parse(body);
  const data = await service.createNetwork(nodeId, config, user.id);
  return c.json({ data }, 201);
});

// Remove network
dockerRoutes.delete('/nodes/:nodeId/networks/:networkId', requireScope('docker:networks'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const networkId = c.req.param('networkId');
  const user = c.get('user')!;
  await service.removeNetwork(nodeId, networkId, user.id);
  return c.json({ success: true });
});

// Connect container to network
dockerRoutes.post('/nodes/:nodeId/networks/:networkId/connect', requireScope('docker:networks'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const networkId = c.req.param('networkId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { containerId } = NetworkConnectSchema.parse(body);
  await service.connectContainerToNetwork(nodeId, networkId, containerId, user.id);
  return c.json({ success: true });
});

// Disconnect container from network
dockerRoutes.post('/nodes/:nodeId/networks/:networkId/disconnect', requireScope('docker:networks'), async (c) => {
  const service = container.resolve(DockerManagementService);
  const nodeId = c.req.param('nodeId');
  const networkId = c.req.param('networkId');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { containerId } = NetworkConnectSchema.parse(body);
  await service.disconnectContainerFromNetwork(nodeId, networkId, containerId, user.id);
  return c.json({ success: true });
});

// ─── Registry routes ──────────────────────────────────────────────────

// List registries
dockerRoutes.get('/registries', requireScope('docker:registries'), async (c) => {
  const service = container.resolve(DockerRegistryService);
  const nodeId = c.req.query('nodeId');
  const data = await service.list(nodeId);
  return c.json({ data });
});

// Create registry
dockerRoutes.post('/registries', requireScope('docker:registries'), async (c) => {
  const service = container.resolve(DockerRegistryService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = RegistryCreateSchema.parse(body);
  const data = await service.create(input, user.id);
  return c.json({ data }, 201);
});

// Update registry
dockerRoutes.put('/registries/:id', requireScope('docker:registries'), async (c) => {
  const service = container.resolve(DockerRegistryService);
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = RegistryUpdateSchema.parse(body);
  const data = await service.update(id, input, user.id);
  return c.json({ data });
});

// Delete registry
dockerRoutes.delete('/registries/:id', requireScope('docker:registries'), async (c) => {
  const service = container.resolve(DockerRegistryService);
  const id = c.req.param('id');
  const user = c.get('user')!;
  await service.delete(id, user.id);
  return c.json({ success: true });
});

// Test registry connection
dockerRoutes.post('/registries/:id/test', requireScope('docker:registries'), async (c) => {
  const service = container.resolve(DockerRegistryService);
  const id = c.req.param('id');
  const data = await service.testConnection(id);
  return c.json({ data });
});

// ─── Template routes ──────────────────────────────────────────────────

// List templates
dockerRoutes.get('/templates', requireScope('docker:templates'), async (c) => {
  const service = container.resolve(DockerTemplateService);
  const data = await service.list();
  return c.json({ data });
});

// Create template
dockerRoutes.post('/templates', requireScope('docker:templates'), async (c) => {
  const service = container.resolve(DockerTemplateService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = TemplateCreateSchema.parse(body);
  const data = await service.create(input, user.id);
  return c.json({ data }, 201);
});

// Update template
dockerRoutes.put('/templates/:id', requireScope('docker:templates'), async (c) => {
  const service = container.resolve(DockerTemplateService);
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = TemplateUpdateSchema.parse(body);
  const data = await service.update(id, input, user.id);
  return c.json({ data });
});

// Delete template
dockerRoutes.delete('/templates/:id', requireScope('docker:templates'), async (c) => {
  const service = container.resolve(DockerTemplateService);
  const id = c.req.param('id');
  const user = c.get('user')!;
  await service.delete(id, user.id);
  return c.json({ success: true });
});

// Deploy from template
dockerRoutes.post('/templates/:id/deploy', requireScope('docker:create'), async (c) => {
  const templateService = container.resolve(DockerTemplateService);
  const dockerService = container.resolve(DockerManagementService);
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json();
  const { nodeId, overrides } = TemplateDeploySchema.parse(body);

  // Get the template config and merge with overrides
  const template = await templateService.get(id);
  const config = { ...(template.config as Record<string, unknown>), ...overrides };

  const data = await dockerService.createContainer(nodeId, config, user.id);
  return c.json({ data }, 201);
});

// ─── Task routes ──────────────────────────────────────────────────────

// List tasks
dockerRoutes.get('/tasks', requireScope('docker:tasks'), async (c) => {
  const service = container.resolve(DockerTaskService);
  const nodeId = c.req.query('nodeId');
  const status = c.req.query('status');
  const type = c.req.query('type');
  const data = await service.list({ nodeId, status, type });
  return c.json({ data });
});

// Get single task
dockerRoutes.get('/tasks/:id', requireScope('docker:tasks'), async (c) => {
  const service = container.resolve(DockerTaskService);
  const id = c.req.param('id');
  const data = await service.get(id);
  return c.json({ data });
});
