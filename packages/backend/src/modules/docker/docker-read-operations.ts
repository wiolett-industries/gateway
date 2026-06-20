import type { AuditService } from '@/modules/audit/audit.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { DOCKER_LOG_TAIL_MAX } from './docker.schemas.js';

type DockerDispatchResult = { success: boolean; error?: string; detail?: string };

export interface DockerReadOperationContext {
  nodeDispatch: NodeDispatchService;
  auditService: AuditService;
  parseResult(result: DockerDispatchResult): any;
}

export async function getContainerLogs(
  context: DockerReadOperationContext,
  nodeId: string,
  containerId: string,
  tail: number,
  timestamps: boolean
) {
  const tailLines = Math.min(Math.max(Math.trunc(tail || 100), 1), DOCKER_LOG_TAIL_MAX);
  const result = await context.nodeDispatch.sendDockerLogsCommand(nodeId, containerId, {
    tailLines,
    timestamps,
  });
  return context.parseResult(result);
}

export async function getContainerStats(context: DockerReadOperationContext, nodeId: string, containerId: string) {
  const result = await context.nodeDispatch.sendDockerContainerCommand(nodeId, 'stats', { containerId });
  return context.parseResult(result);
}

export async function getContainerTop(context: DockerReadOperationContext, nodeId: string, containerId: string) {
  const result = await context.nodeDispatch.sendDockerContainerCommand(nodeId, 'top', { containerId });
  return context.parseResult(result);
}

export async function listDirectory(
  context: DockerReadOperationContext,
  nodeId: string,
  containerId: string,
  path: string
) {
  const result = await context.nodeDispatch.sendDockerFileCommand(nodeId, 'list', { containerId, path });
  return context.parseResult(result);
}

export async function readFile(context: DockerReadOperationContext, nodeId: string, containerId: string, path: string) {
  const result = await context.nodeDispatch.sendDockerFileCommand(nodeId, 'read', {
    containerId,
    path,
    maxBytes: 1048576,
  });
  return context.parseResult(result);
}

export async function writeFile(
  context: DockerReadOperationContext,
  nodeId: string,
  containerId: string,
  path: string,
  content: string,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerFileCommand(nodeId, 'write', {
    containerId,
    path,
    content,
  });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.file.write',
    userId,
    resourceType: 'docker-container',
    resourceId: containerId,
    details: { nodeId, path },
  });
}
