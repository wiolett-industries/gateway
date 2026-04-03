import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { DockerTaskService } from './docker-task.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';

type ContainerTransition = 'stopping' | 'restarting' | 'killing' | 'recreating' | 'updating';

export class DockerManagementService {
  /** Container ID → current transition state */
  private containerTransitions = new Map<string, ContainerTransition>();

  private taskService?: DockerTaskService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private nodeDispatch: NodeDispatchService,
    private nodeRegistry: NodeRegistryService
  ) {}

  setTaskService(taskService: DockerTaskService) {
    this.taskService = taskService;
  }

  private requireNoTransition(containerId: string) {
    const current = this.containerTransitions.get(containerId);
    if (current) {
      throw new AppError(409, 'CONTAINER_BUSY', `Container is currently ${current}`);
    }
  }

  private setTransition(containerId: string, state: ContainerTransition) {
    this.containerTransitions.set(containerId, state);
  }

  private clearTransition(containerId: string) {
    this.containerTransitions.delete(containerId);
  }

  getContainerTransition(containerId: string): ContainerTransition | undefined {
    return this.containerTransitions.get(containerId);
  }

  private async resolveContainerName(nodeId: string, containerId: string): Promise<string> {
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
      const data = this.parseResult(result);
      return (data?.Name ?? '').replace(/^\//, '') || containerId.slice(0, 12);
    } catch {
      return containerId.slice(0, 12);
    }
  }

  private async createTask(nodeId: string, containerId: string, containerName: string, type: string) {
    if (!this.taskService) return undefined;
    const task = await this.taskService.create({ nodeId, containerId, containerName, type });
    await this.taskService.update(task.id, { status: 'running' });
    return task;
  }

  /**
   * Poll container state to detect when an async operation completes,
   * then mark the task as succeeded and clear the transition.
   */
  private watchTransition(
    nodeId: string,
    containerId: string,
    taskId: string | undefined,
    expectedState: string,
    progress: string,
    timeoutMs = 60000
  ) {
    const start = Date.now();
    const poll = setInterval(async () => {
      try {
        const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
        const data = this.parseResult(result);
        const state = data?.State?.Status;
        if (state === expectedState || Date.now() - start > timeoutMs) {
          clearInterval(poll);
          this.clearTransition(containerId);
          if (taskId && this.taskService) {
            await this.taskService.update(taskId, { status: 'succeeded', progress, completedAt: new Date() }).catch(() => {});
          }
        }
      } catch {
        // Container might not exist during recreate — keep polling
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          this.clearTransition(containerId);
          if (taskId && this.taskService) {
            await this.taskService.update(taskId, { status: 'failed', error: 'Timed out', completedAt: new Date() }).catch(() => {});
          }
        }
      }
    }, 2000);
  }

  private async validateDockerNode(nodeId: string) {
    const [node] = await this.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found');
    if (node.type !== 'docker') throw new AppError(400, 'NOT_DOCKER', 'Node is not a Docker node');
    if (!this.nodeRegistry.getNode(nodeId)) throw new AppError(502, 'NODE_OFFLINE', 'Node is offline');
    return node;
  }

  private parseResult(result: { success: boolean; error?: string; detail?: string }) {
    if (!result.success) {
      throw new AppError(502, 'DISPATCH_ERROR', result.error || 'Command failed on daemon');
    }
    try {
      return result.detail ? JSON.parse(result.detail) : null;
    } catch {
      return result.detail;
    }
  }

  // ─── Container operations ──────────────────────────────────────────

  async listContainers(nodeId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'list');
    const containers = this.parseResult(result);
    // Inject transition states into the list
    if (Array.isArray(containers) && this.containerTransitions.size > 0) {
      for (const c of containers) {
        const transition = this.containerTransitions.get(c.id);
        if (transition) c._transition = transition;
      }
    }
    return containers;
  }

  async inspectContainer(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const data = this.parseResult(result);
    const transition = this.containerTransitions.get(containerId);
    if (data && transition) {
      data._transition = transition;
    }
    return data;
  }

  async createContainer(nodeId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'create', {
      configJson: JSON.stringify(config),
    });
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.create',
      userId,
      resourceType: 'docker-container',
      details: { nodeId, name: config.name, image: config.image },
    });
    return data;
  }

  async startContainer(nodeId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'start', { containerId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.start',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async stopContainer(nodeId: string, containerId: string, timeout: number, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    this.setTransition(containerId, 'stopping');
    const name = await this.resolveContainerName(nodeId, containerId);
    const task = await this.createTask(nodeId, containerId, name, 'stop');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'stop', {
      containerId,
      timeoutSeconds: timeout,
    });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, task?.id, 'exited', 'Container stopped');
    await this.auditService.log({
      action: 'docker.container.stop',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async restartContainer(nodeId: string, containerId: string, timeout: number, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    this.setTransition(containerId, 'restarting');
    const name = await this.resolveContainerName(nodeId, containerId);
    const task = await this.createTask(nodeId, containerId, name, 'restart');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'restart', {
      containerId,
      timeoutSeconds: timeout,
    });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, task?.id, 'running', 'Container restarted');
    await this.auditService.log({
      action: 'docker.container.restart',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async killContainer(nodeId: string, containerId: string, signal: string, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    this.setTransition(containerId, 'killing');
    const name = await this.resolveContainerName(nodeId, containerId);
    const task = await this.createTask(nodeId, containerId, name, 'kill');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'kill', { containerId, signal });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, task?.id, 'exited', `Container killed (${signal})`);
    await this.auditService.log({
      action: 'docker.container.kill',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, signal },
    });
  }

  async removeContainer(nodeId: string, containerId: string, force: boolean, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'remove', { containerId, force });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.remove',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, force },
    });
  }

  async renameContainer(nodeId: string, containerId: string, name: string, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'rename', { containerId, newName: name });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.rename',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, name },
    });
  }

  async duplicateContainer(nodeId: string, containerId: string, name: string, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'duplicate', {
      containerId,
      newName: name,
    });
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.duplicate',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, name },
    });
    return data;
  }

  async updateContainer(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    this.setTransition(containerId, 'updating');
    const name = await this.resolveContainerName(nodeId, containerId);
    const task = await this.createTask(nodeId, containerId, name, 'update');
    const result = await this.nodeDispatch.sendDockerContainerCommand(
      nodeId,
      'update',
      { containerId, configJson: JSON.stringify(config) },
      120000 // 2min timeout for pull+redeploy
    );
    const data = this.parseResult(result);
    this.watchTransition(nodeId, containerId, task?.id, 'running', 'Container updated');
    await this.auditService.log({
      action: 'docker.container.update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
    return data;
  }

  async getContainerLogs(nodeId: string, containerId: string, tail: number, timestamps: boolean) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerLogsCommand(nodeId, containerId, {
      tailLines: tail,
      timestamps,
    });
    return this.parseResult(result);
  }

  async getContainerEnv(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const inspect = this.parseResult(result);
    return inspect?.Config?.Env || [];
  }

  async liveUpdateContainer(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(
      nodeId,
      'live_update',
      { containerId, configJson: JSON.stringify(config) }
    );
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.live_update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async recreateWithConfig(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    this.setTransition(containerId, 'recreating');
    const name = await this.resolveContainerName(nodeId, containerId);
    const task = await this.createTask(nodeId, containerId, name, 'recreate');

    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(
        nodeId,
        'recreate',
        { containerId, configJson: JSON.stringify(config) },
        120000 // 2min timeout
      );
      const data = this.parseResult(result);
      await this.auditService.log({
        action: 'docker.container.recreate',
        userId,
        resourceType: 'docker-container',
        resourceId: containerId,
        details: { nodeId },
      });
      // Note: containerId changes after recreate, but watchTransition will time out
      // and clear the old transition. The frontend handles navigation to new ID.
      this.watchTransition(nodeId, containerId, task?.id, 'running', 'Container recreated');
      return data;
    } catch (err) {
      this.clearTransition(containerId);
      if (task && this.taskService) {
        await this.taskService.update(task.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
          completedAt: new Date(),
        }).catch(() => {});
      }
      throw err;
    }
  }

  async updateContainerEnv(
    nodeId: string,
    containerId: string,
    env: Record<string, string> | undefined,
    removeEnv: string[] | undefined,
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    this.requireNoTransition(containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(
      nodeId,
      'update',
      { containerId, configJson: JSON.stringify({ env, removeEnv }) },
      60000
    );
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.env.update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
    return data;
  }

  // ─── Image operations ──────────────────────────────────────────────

  async listImages(nodeId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerImageCommand(nodeId, 'list');
    return this.parseResult(result);
  }

  async pullImage(nodeId: string, imageRef: string, registryAuth?: string, userId?: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerImageCommand(
      nodeId,
      'pull',
      { imageRef, registryAuthJson: registryAuth },
      300000
    );
    const data = this.parseResult(result);
    if (userId) {
      await this.auditService.log({
        action: 'docker.image.pull',
        userId,
        resourceType: 'docker-image',
        details: { nodeId, imageRef },
      });
    }
    return data;
  }

  async removeImage(nodeId: string, imageId: string, force: boolean, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerImageCommand(nodeId, 'remove', { imageRef: imageId, force });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.image.remove',
      userId,
      resourceType: 'docker-image',
      resourceId: imageId,
      details: { nodeId },
    });
  }

  async pruneImages(nodeId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerImageCommand(nodeId, 'prune');
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.image.prune',
      userId,
      resourceType: 'docker-image',
      details: { nodeId },
    });
    return data;
  }

  // ─── Volume operations ─────────────────────────────────────────────

  async listVolumes(nodeId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerVolumeCommand(nodeId, 'list');
    return this.parseResult(result);
  }

  async createVolume(
    nodeId: string,
    config: { name: string; driver: string; labels?: Record<string, string> },
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerVolumeCommand(nodeId, 'create', config);
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.volume.create',
      userId,
      resourceType: 'docker-volume',
      details: { nodeId, name: config.name },
    });
    return data;
  }

  async removeVolume(nodeId: string, name: string, force: boolean, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerVolumeCommand(nodeId, 'remove', { name, force });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.volume.remove',
      userId,
      resourceType: 'docker-volume',
      resourceId: name,
      details: { nodeId },
    });
  }

  // ─── Network operations ────────────────────────────────────────────

  async listNetworks(nodeId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'list');
    return this.parseResult(result);
  }

  async createNetwork(
    nodeId: string,
    config: { name: string; driver: string; subnet?: string; gateway?: string },
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'create', {
      networkId: config.name,
      driver: config.driver,
      subnet: config.subnet,
      gatewayAddr: config.gateway,
    });
    const data = this.parseResult(result);
    await this.auditService.log({
      action: 'docker.network.create',
      userId,
      resourceType: 'docker-network',
      details: { nodeId, name: config.name },
    });
    return data;
  }

  async removeNetwork(nodeId: string, networkId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'remove', { networkId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.network.remove',
      userId,
      resourceType: 'docker-network',
      resourceId: networkId,
      details: { nodeId },
    });
  }

  async connectContainerToNetwork(nodeId: string, networkId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'connect', { networkId, containerId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.network.connect',
      userId,
      resourceType: 'docker-network',
      resourceId: networkId,
      details: { nodeId, containerId },
    });
  }

  async disconnectContainerFromNetwork(nodeId: string, networkId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'disconnect', { networkId, containerId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.network.disconnect',
      userId,
      resourceType: 'docker-network',
      resourceId: networkId,
      details: { nodeId, containerId },
    });
  }

  // ─── Container stats ───────────────────────────────────────────────

  async getContainerStats(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'stats', { containerId });
    return this.parseResult(result);
  }

  async getContainerTop(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'top', { containerId });
    return this.parseResult(result);
  }

  // ─── File browser ──────────────────────────────────────────────────

  async listDirectory(nodeId: string, containerId: string, path: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerFileCommand(nodeId, 'list', { containerId, path });
    return this.parseResult(result);
  }

  async readFile(nodeId: string, containerId: string, path: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerFileCommand(nodeId, 'read', {
      containerId,
      path,
      maxBytes: 1048576,
    });
    return this.parseResult(result);
  }

  async writeFile(nodeId: string, containerId: string, path: string, content: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerFileCommand(nodeId, 'write', {
      containerId,
      path,
      content,
    });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.file.write',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, path },
    });
  }
}
