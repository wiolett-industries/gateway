import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

type DockerDispatchResult = { success: boolean; error?: string; detail?: string };

export interface DockerVolumeNetworkOperationContext {
  nodeDispatch: NodeDispatchService;
  auditService: AuditService;
  eventBus?: EventBusService;
  parseResult(result: DockerDispatchResult): any;
}

export async function listVolumes(context: DockerVolumeNetworkOperationContext, nodeId: string) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'list');
  return context.parseResult(result);
}

export async function inspectVolume(context: DockerVolumeNetworkOperationContext, nodeId: string, name: string) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'inspect', { name });
  return context.parseResult(result);
}

export async function listVolumeFiles(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  name: string,
  path: string
) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'list-files', { name, path });
  return context.parseResult(result);
}

export async function exportVolume(context: DockerVolumeNetworkOperationContext, nodeId: string, name: string) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'export', { name });
  return context.parseResult(result);
}

export async function renameVolume(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  name: string,
  newName: string,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'rename', { name, newName });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.volume.rename',
    userId,
    resourceType: 'docker-volume',
    resourceId: newName,
    details: { nodeId, oldName: name, name: newName },
  });
  context.eventBus?.publish('docker.volume.changed', { nodeId, name: newName, action: 'renamed', oldName: name });
}

export async function updateVolumeLabels(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  name: string,
  labels: Record<string, string>,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'update-labels', { name, labels });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.volume.labels.update',
    userId,
    resourceType: 'docker-volume',
    resourceId: name,
    details: { nodeId, name },
  });
  context.eventBus?.publish('docker.volume.changed', { nodeId, name, action: 'labels-updated' });
}

export async function createVolume(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  config: { name: string; driver: string; labels?: Record<string, string> },
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'create', config);
  const data = context.parseResult(result);
  await context.auditService.log({
    action: 'docker.volume.create',
    userId,
    resourceType: 'docker-volume',
    details: { nodeId, name: config.name },
  });
  context.eventBus?.publish('docker.volume.changed', { nodeId, name: config.name, action: 'created' });
  return data;
}

export async function removeVolume(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  name: string,
  force: boolean,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerVolumeCommand(nodeId, 'remove', { name, force });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.volume.remove',
    userId,
    resourceType: 'docker-volume',
    resourceId: name,
    details: { nodeId },
  });
  context.eventBus?.publish('docker.volume.changed', { nodeId, name, action: 'removed' });
}

export async function listNetworks(context: DockerVolumeNetworkOperationContext, nodeId: string) {
  const result = await context.nodeDispatch.sendDockerNetworkCommand(nodeId, 'list');
  return context.parseResult(result);
}

export function isBuiltInDockerNetwork(name: string) {
  return ['bridge', 'host', 'none'].includes(name);
}

export async function resolveNetworkName(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  networkId: string
) {
  const networks = await listNetworks(context, nodeId);
  if (!Array.isArray(networks)) return networkId;

  const match = networks.find((network: any) => {
    const id = String(network.id ?? network.Id ?? '');
    const name = String(network.name ?? network.Name ?? '');
    return id === networkId || name === networkId;
  });

  return String(match?.name ?? match?.Name ?? networkId);
}

export async function createNetwork(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  config: { name: string; driver: string; subnet?: string; gateway?: string },
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerNetworkCommand(nodeId, 'create', {
    networkId: config.name,
    driver: config.driver,
    subnet: config.subnet,
    gatewayAddr: config.gateway,
  });
  const data = context.parseResult(result);
  await context.auditService.log({
    action: 'docker.network.create',
    userId,
    resourceType: 'docker-network',
    details: { nodeId, name: config.name },
  });
  context.eventBus?.publish('docker.network.changed', { nodeId, name: config.name, action: 'created' });
  return data;
}

export async function removeNetwork(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  networkId: string,
  userId: string
) {
  const networkName = await resolveNetworkName(context, nodeId, networkId);
  if (isBuiltInDockerNetwork(networkName)) {
    throw new AppError(400, 'BUILTIN_NETWORK', 'Built-in Docker networks cannot be removed');
  }
  const result = await context.nodeDispatch.sendDockerNetworkCommand(nodeId, 'remove', { networkId });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.network.remove',
    userId,
    resourceType: 'docker-network',
    resourceId: networkId,
    details: { nodeId },
  });
  context.eventBus?.publish('docker.network.changed', { nodeId, name: networkId, action: 'removed' });
}

export async function connectContainerToNetwork(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  networkId: string,
  containerId: string,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerNetworkCommand(nodeId, 'connect', { networkId, containerId });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.network.connect',
    userId,
    resourceType: 'docker-network',
    resourceId: networkId,
    details: { nodeId, containerId },
  });
}

export async function disconnectContainerFromNetwork(
  context: DockerVolumeNetworkOperationContext,
  nodeId: string,
  networkId: string,
  containerId: string,
  userId: string
) {
  const networkName = await resolveNetworkName(context, nodeId, networkId);
  if (isBuiltInDockerNetwork(networkName)) {
    throw new AppError(400, 'BUILTIN_NETWORK', 'Containers cannot be disconnected from built-in Docker networks');
  }
  const result = await context.nodeDispatch.sendDockerNetworkCommand(nodeId, 'disconnect', { networkId, containerId });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.network.disconnect',
    userId,
    resourceType: 'docker-network',
    resourceId: networkId,
    details: { nodeId, containerId },
  });
}
