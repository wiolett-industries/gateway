import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { DockerRegistryService } from './docker-registry.service.js';
import type { DockerTaskService } from './docker-task.service.js';

type DockerDispatchResult = { success: boolean; error?: string; detail?: string };

export interface DockerImageOperationContext {
  nodeDispatch: NodeDispatchService;
  auditService: AuditService;
  taskService?: DockerTaskService;
  registryService?: DockerRegistryService;
  eventBus?: EventBusService;
  parseResult(result: DockerDispatchResult): unknown;
  createTask(
    nodeId: string,
    containerId: string,
    containerName: string,
    type: string
  ): Promise<{ id: string } | undefined>;
  longDockerOperationTimeoutMs: number;
}

export async function listImages(context: DockerImageOperationContext, nodeId: string) {
  const result = await context.nodeDispatch.sendDockerImageCommand(nodeId, 'list');
  return context.parseResult(result);
}

export async function pullImage(
  context: DockerImageOperationContext,
  nodeId: string,
  imageRef: string,
  registryAuth?: string,
  userId?: string,
  registryId?: string
) {
  const task = await context.createTask(nodeId, '', imageRef, 'pull');
  if (userId) {
    await context.auditService.log({
      action: 'docker.image.pull',
      userId,
      resourceType: 'docker-image',
      details: { nodeId, imageRef },
    });
  }

  context.nodeDispatch
    .sendDockerImageCommand(
      nodeId,
      'pull',
      { imageRef, registryAuthJson: registryAuth },
      context.longDockerOperationTimeoutMs
    )
    .then(async (result) => {
      try {
        context.parseResult(result);
      } catch (err) {
        if (task?.id && context.taskService) {
          context.taskService
            .update(task.id, {
              status: 'failed',
              error: err instanceof Error ? err.message : 'Pull failed',
              completedAt: new Date(),
            })
            .catch(() => {});
        }
        return;
      }
      if (task?.id && context.taskService) {
        context.taskService
          .update(task.id, { status: 'succeeded', progress: `Pulled ${imageRef}`, completedAt: new Date() })
          .catch(() => {});
      }
      await context.registryService?.rememberImageRegistry?.(nodeId, imageRef, registryId);
      context.eventBus?.publish('docker.image.changed', { nodeId, ref: imageRef, action: 'pulled' });
    })
    .catch((err) => {
      if (task?.id && context.taskService) {
        context.taskService
          .update(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Pull failed',
            completedAt: new Date(),
          })
          .catch(() => {});
      }
    });

  return { taskId: task?.id, message: `Pulling ${imageRef}...` };
}

export async function removeImage(
  context: DockerImageOperationContext,
  nodeId: string,
  imageId: string,
  force: boolean,
  userId: string
) {
  const result = await context.nodeDispatch.sendDockerImageCommand(nodeId, 'remove', { imageRef: imageId, force });
  context.parseResult(result);
  await context.auditService.log({
    action: 'docker.image.remove',
    userId,
    resourceType: 'docker-image',
    resourceId: imageId,
    details: { nodeId },
  });
  context.eventBus?.publish('docker.image.changed', { nodeId, ref: imageId, action: 'removed' });
}

export async function pruneImages(context: DockerImageOperationContext, nodeId: string, userId: string) {
  const result = await context.nodeDispatch.sendDockerImageCommand(nodeId, 'prune');
  const data = context.parseResult(result);
  await context.auditService.log({
    action: 'docker.image.prune',
    userId,
    resourceType: 'docker-image',
    details: { nodeId },
  });
  context.eventBus?.publish('docker.image.changed', { nodeId, ref: '*', action: 'pruned' });
  return data;
}
