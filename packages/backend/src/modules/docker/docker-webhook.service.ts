import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerWebhooks } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { DockerManagementService } from './docker.service.js';
import type { DockerDeploymentService } from './docker-deployment.service.js';
import type { DockerRegistryService } from './docker-registry.service.js';
import type { DockerTaskService } from './docker-task.service.js';

const logger = createChildLogger('DockerWebhookService');

export class DockerWebhookService {
  private eventBus?: EventBusService;

  constructor(
    private db: DrizzleClient,
    private docker: DockerManagementService,
    private tasks: DockerTaskService,
    private audit: AuditService,
    private dispatch: NodeDispatchService,
    private registry: DockerRegistryService,
    private deployments?: DockerDeploymentService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  // ─── Config CRUD ──────────────────────────────────────────────────

  async getByContainer(nodeId: string, containerName: string) {
    const [row] = await this.db
      .select()
      .from(dockerWebhooks)
      .where(
        and(
          eq(dockerWebhooks.nodeId, nodeId),
          eq(dockerWebhooks.containerName, containerName),
          eq(dockerWebhooks.targetType, 'container')
        )
      )
      .limit(1);
    return row ?? null;
  }

  async getByToken(token: string) {
    const [row] = await this.db.select().from(dockerWebhooks).where(eq(dockerWebhooks.token, token)).limit(1);
    return row ?? null;
  }

  async getByDeployment(deploymentId: string) {
    const [row] = await this.db
      .select()
      .from(dockerWebhooks)
      .where(and(eq(dockerWebhooks.deploymentId, deploymentId), eq(dockerWebhooks.targetType, 'deployment')))
      .limit(1);
    return row ?? null;
  }

  async upsert(
    nodeId: string,
    containerName: string,
    input: { cleanupEnabled?: boolean; retentionCount?: number },
    userId: string
  ) {
    const existing = await this.getByContainer(nodeId, containerName);
    if (existing) {
      const [updated] = await this.db
        .update(dockerWebhooks)
        .set({
          cleanupEnabled: input.cleanupEnabled ?? existing.cleanupEnabled,
          retentionCount: input.retentionCount ?? existing.retentionCount,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(dockerWebhooks.id, existing.id))
        .returning();
      this.emit('updated', updated);
      return updated;
    }

    const [created] = await this.db
      .insert(dockerWebhooks)
      .values({
        nodeId,
        containerName,
        targetType: 'container',
        cleanupEnabled: input.cleanupEnabled ?? false,
        retentionCount: input.retentionCount ?? 2,
      })
      .returning();

    await this.audit.log({
      action: 'docker.webhook.created',
      userId,
      resourceType: 'docker-webhook',
      resourceId: created.id,
      details: { nodeId, containerName },
    });
    this.emit('created', created);
    return created;
  }

  async remove(nodeId: string, containerName: string, userId: string) {
    const existing = await this.getByContainer(nodeId, containerName);
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Webhook not found');

    await this.db.delete(dockerWebhooks).where(eq(dockerWebhooks.id, existing.id));

    await this.audit.log({
      action: 'docker.webhook.deleted',
      userId,
      resourceType: 'docker-webhook',
      resourceId: existing.id,
      details: { nodeId, containerName },
    });
    this.emit('deleted', existing);
  }

  async regenerateToken(nodeId: string, containerName: string, userId: string) {
    const existing = await this.getByContainer(nodeId, containerName);
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Webhook not found');

    const [updated] = await this.db
      .update(dockerWebhooks)
      .set({ token: randomUUID(), updatedAt: new Date() })
      .where(eq(dockerWebhooks.id, existing.id))
      .returning();

    await this.audit.log({
      action: 'docker.webhook.regenerated',
      userId,
      resourceType: 'docker-webhook',
      resourceId: existing.id,
      details: { nodeId, containerName },
    });
    this.emit('updated', updated);
    return updated;
  }

  // ─── Core update action ───────────────────────────────────────────

  async triggerUpdate(params: {
    nodeId: string;
    containerName: string;
    containerId: string;
    tag?: string;
    userId?: string;
    webhookId?: string;
  }): Promise<{ taskId: string; message: string }> {
    const { nodeId, containerName, containerId, tag, userId, webhookId } = params;

    // Inspect current container to get its config
    const inspectData = await this.docker.inspectContainer(nodeId, containerId);
    const currentImage: string = (inspectData as any)?.Config?.Image ?? '';
    if (!currentImage) {
      throw new AppError(400, 'NO_IMAGE', 'Cannot determine current container image');
    }

    const { imageName, currentTag } = parseImageRef(currentImage);
    const targetTag = tag ?? currentTag;
    const targetRef = `${imageName}:${targetTag}`;

    // Check container is not busy
    this.docker.requireNoTransition(nodeId, containerName);

    // Create task for tracking
    const task = await this.tasks.create({
      nodeId,
      containerId,
      containerName,
      type: 'webhook_update',
    });
    await this.tasks.update(task.id, { status: 'running', progress: `Pulling ${targetRef}...` });

    // Set transition and broadcast to frontend
    this.docker.setTransition(nodeId, containerName, 'updating');
    this.docker.emitTransition(nodeId, containerName, containerId, 'updating');

    try {
      // Synchronous pull — validates the image exists
      const registryAuth = await this.registry.resolveAuthForImagePull(nodeId, targetRef);
      const pullPayload: { imageRef: string; registryAuthJson?: string } = { imageRef: targetRef };
      if (registryAuth) {
        pullPayload.registryAuthJson = registryAuth.authJson;
      }

      const pullResult = await this.dispatch.sendDockerImageCommand(nodeId, 'pull', pullPayload, 600000);
      if (!pullResult.success) {
        throw new AppError(400, 'PULL_FAILED', pullResult.error || `Failed to pull ${targetRef}`);
      }
    } catch (err) {
      this.docker.clearTransition(nodeId, containerName);
      await this.tasks
        .update(task.id, {
          status: 'failed',
          error: err instanceof AppError ? err.message : err instanceof Error ? err.message : 'Pull failed',
          completedAt: new Date(),
        })
        .catch(() => {});
      throw err;
    }

    // Clear our transition — recreateWithConfig will set 'recreating'
    this.docker.clearTransition(nodeId, containerName);

    // Build recreate config from current inspect
    const config = buildRecreateConfig(inspectData as Record<string, unknown>, targetRef);

    try {
      await this.docker.recreateWithConfig(nodeId, containerId, config, userId ?? (null as any));
    } catch (err) {
      await this.tasks
        .update(task.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Recreate failed',
          completedAt: new Date(),
        })
        .catch(() => {});
      throw err;
    }

    // Mark our tracking task as succeeded (recreateWithConfig has its own task for the recreate itself)
    await this.tasks
      .update(task.id, {
        status: 'succeeded',
        progress: `Updated to ${targetRef}`,
        completedAt: new Date(),
      })
      .catch(() => {});

    // Audit
    await this.audit
      .log({
        action: 'docker.webhook.triggered',
        userId: userId ?? null,
        resourceType: 'docker-container',
        resourceId: containerId,
        details: {
          nodeId,
          containerName,
          from: currentImage,
          to: targetRef,
          source: webhookId ? 'webhook' : 'manual',
        },
      })
      .catch(() => {});

    // Async cleanup if webhook config exists and cleanup enabled
    this.scheduleCleanup(nodeId, containerName, imageName).catch(() => {});

    const message = `Updating ${containerName} to ${targetRef}`;
    logger.info(message, { nodeId, containerId, webhookId });
    return { taskId: task.id, message };
  }

  async triggerWebhookToken(token: string, tag?: string, userId?: string) {
    const webhook = await this.getByToken(token);
    if (!webhook || !webhook.enabled) {
      throw new AppError(404, 'NOT_FOUND', 'Webhook not found');
    }
    if (webhook.targetType === 'deployment') {
      if (!this.deployments) throw new AppError(500, 'DEPLOYMENTS_UNAVAILABLE', 'Deployment service unavailable');
      return this.deployments.triggerWebhook(webhook.id, tag);
    }
    return this.triggerUpdate({
      nodeId: webhook.nodeId,
      containerName: webhook.containerName,
      containerId: webhook.containerName,
      tag,
      userId,
      webhookId: webhook.id,
    });
  }

  // ─── Image cleanup ────────────────────────────────────────────────

  private async scheduleCleanup(nodeId: string, containerName: string, imageName: string) {
    const webhook = await this.getByContainer(nodeId, containerName);
    if (!webhook?.cleanupEnabled) return;
    // Small delay to let the recreate complete
    await new Promise((r) => setTimeout(r, 5000));
    await this.performCleanup(nodeId, imageName, webhook.retentionCount);
  }

  private async performCleanup(nodeId: string, imageName: string, retentionCount: number) {
    try {
      // List all images on the node
      const images = await this.docker.listImages(nodeId);
      if (!Array.isArray(images)) return;

      // Filter to same image name
      const matching: Array<{ id: string; tag: string; created: number }> = [];
      for (const img of images) {
        const tags: string[] = img.RepoTags ?? img.repoTags ?? [];
        for (const t of tags) {
          const colonIdx = t.lastIndexOf(':');
          if (colonIdx === -1) continue;
          const name = t.slice(0, colonIdx);
          const tagPart = t.slice(colonIdx + 1);
          if (name === imageName || normalizeImageName(name) === normalizeImageName(imageName)) {
            matching.push({ id: img.Id ?? img.id, tag: tagPart, created: img.Created ?? img.created ?? 0 });
          }
        }
      }

      if (matching.length <= retentionCount) return;

      // List all containers to find in-use images
      const containers = await this.docker.listContainers(nodeId);
      const inUseImageIds = new Set<string>();
      if (Array.isArray(containers)) {
        for (const c of containers) {
          if (c.ImageID ?? c.imageId) inUseImageIds.add(c.ImageID ?? c.imageId);
        }
      }

      // Sort by creation date desc, keep retentionCount, remove the rest
      matching.sort((a, b) => b.created - a.created);
      const toRemove = matching.slice(retentionCount);

      for (const img of toRemove) {
        if (inUseImageIds.has(img.id)) {
          logger.debug('Skipping cleanup of in-use image', { imageId: img.id, tag: img.tag });
          continue;
        }
        try {
          await this.docker.removeImage(nodeId, img.id, false, 'system');
          logger.info('Cleaned up old image', { imageId: img.id, tag: img.tag, imageName });
        } catch (err) {
          logger.debug('Failed to remove old image (may be referenced)', {
            imageId: img.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      logger.warn('Image cleanup failed', {
        nodeId,
        imageName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private emit(action: string, data: Record<string, unknown>) {
    this.eventBus?.publish('docker.webhook.changed', { ...data, action });
  }
}

// ─── Module-level helpers ────────────────────────────────────────────

/** Parse "image:tag" into components. Handles images with registry prefixes. */
function parseImageRef(ref: string): { imageName: string; currentTag: string } {
  // Handle refs like "registry.com/repo:tag", "repo:tag", "repo" (defaults to latest)
  const lastColon = ref.lastIndexOf(':');
  // Check if the colon is part of a port number (e.g., registry.com:5000/repo)
  const lastSlash = ref.lastIndexOf('/');
  if (lastColon === -1 || lastSlash > lastColon) {
    return { imageName: ref, currentTag: 'latest' };
  }
  return { imageName: ref.slice(0, lastColon), currentTag: ref.slice(lastColon + 1) };
}

/** Normalize image name for comparison (strip docker.io/library/ etc.) */
function normalizeImageName(name: string): string {
  return name
    .replace(/^docker\.io\/library\//, '')
    .replace(/^index\.docker\.io\/library\//, '')
    .replace(/^docker\.io\//, '')
    .replace(/^index\.docker\.io\//, '')
    .replace(/^library\//, '');
}

/** Build a recreate config from inspect data, overriding the image. */
function buildRecreateConfig(inspect: Record<string, unknown>, newImage: string): Record<string, unknown> {
  const config = (inspect as any)?.Config ?? {};
  const hostConfig = (inspect as any)?.HostConfig ?? {};
  const networkingConfig = (inspect as any)?.NetworkingConfig ?? {};

  return {
    image: newImage,
    env: config.Env,
    cmd: config.Cmd,
    entrypoint: config.Entrypoint,
    workingDir: config.WorkingDir,
    user: config.User,
    hostname: config.Hostname,
    labels: config.Labels,
    exposedPorts: config.ExposedPorts,
    hostConfig,
    networkingConfig,
  };
}
