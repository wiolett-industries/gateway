import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { DockerSecretService } from './docker-secret.service.js';
import type { DockerTaskService } from './docker-task.service.js';

export type ContainerTransition = 'creating' | 'stopping' | 'restarting' | 'killing' | 'recreating' | 'updating';

type ContainerAction =
  | 'created'
  | 'started'
  | 'stopped'
  | 'restarted'
  | 'killed'
  | 'removed'
  | 'renamed'
  | 'updated'
  | 'recreated'
  | 'duplicated';

export class DockerManagementService {
  /**
   * `${nodeId}:${containerName}` → current transition state.
   * Keyed by name (not ID) so the badge survives recreate/update, which
   * destroy the old container and create a new one with a different ID.
   */
  private containerTransitions = new Map<string, ContainerTransition>();

  private taskService?: DockerTaskService;
  private secretService?: DockerSecretService;
  private eventBus?: EventBusService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private nodeDispatch: NodeDispatchService,
    private nodeRegistry: NodeRegistryService
  ) {}

  setTaskService(taskService: DockerTaskService) {
    this.taskService = taskService;
  }

  setSecretService(secretService: DockerSecretService) {
    this.secretService = secretService;
  }

  setEventBus(eventBus: EventBusService) {
    this.eventBus = eventBus;
  }

  private emitContainer(
    nodeId: string,
    name: string,
    id: string,
    action: ContainerAction,
    extra?: Record<string, unknown>
  ) {
    this.eventBus?.publish('docker.container.changed', { nodeId, name, id, action, ...(extra || {}) });
  }

  emitTransition(nodeId: string, name: string, id: string, transition: ContainerTransition) {
    this.eventBus?.publish('docker.container.changed', { nodeId, name, id, action: 'transitioning', transition });
  }

  private emitImage(nodeId: string, ref: string, action: 'pulled' | 'removed' | 'pruned') {
    this.eventBus?.publish('docker.image.changed', { nodeId, ref, action });
  }

  private emitVolume(nodeId: string, name: string, action: 'created' | 'removed' | 'pruned') {
    this.eventBus?.publish('docker.volume.changed', { nodeId, name, action });
  }

  private emitNetwork(nodeId: string, name: string, action: 'created' | 'removed' | 'pruned') {
    this.eventBus?.publish('docker.network.changed', { nodeId, name, action });
  }

  /**
   * Verify the target name is not already taken on this node.
   * Two-layer guard: (1) blocks if a name-keyed transition is in flight,
   * (2) lists containers and rejects if the name already exists.
   * Should be called BEFORE dispatching create/rename/duplicate to the daemon.
   */
  private async assertNameAvailable(nodeId: string, name: string) {
    if (this.getTransition(nodeId, name)) {
      throw new AppError(409, 'NAME_IN_USE', `A container named "${name}" is currently being modified on this node`);
    }
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'list');
      const containers = this.parseResult(result);
      if (Array.isArray(containers)) {
        const collision = containers.some((c: any) => {
          const cName = ((c.name ?? c.Name ?? '') as string).replace(/^\//, '');
          return cName === name;
        });
        if (collision) {
          throw new AppError(409, 'NAME_IN_USE', `A container named "${name}" already exists on this node`);
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // If listing fails for any other reason, fall through and let the daemon
      // surface the conflict. The daemon error translator will tag it.
    }
  }

  /**
   * Translate a Docker name-conflict error from the daemon into a friendly
   * AppError. Pass any caught error through this on create/rename/duplicate.
   */
  private translateNameConflict(err: unknown, name: string): never {
    const message = err instanceof Error ? err.message : String(err);
    if (/already in use|name.*conflict|409/i.test(message)) {
      throw new AppError(409, 'NAME_IN_USE', `A container named "${name}" already exists on this node`);
    }
    throw err;
  }

  private transitionKey(nodeId: string, name: string) {
    return `${nodeId}:${name}`;
  }

  requireNoTransition(nodeId: string, name: string) {
    const current = this.containerTransitions.get(this.transitionKey(nodeId, name));
    if (current) {
      throw new AppError(409, 'CONTAINER_BUSY', `Container is currently ${current}`);
    }
  }

  setTransition(nodeId: string, name: string, state: ContainerTransition) {
    this.containerTransitions.set(this.transitionKey(nodeId, name), state);
  }

  clearTransition(nodeId: string, name: string) {
    this.containerTransitions.delete(this.transitionKey(nodeId, name));
  }

  private getTransition(nodeId: string, name: string): ContainerTransition | undefined {
    return this.containerTransitions.get(this.transitionKey(nodeId, name));
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

  private async resolveExpectedRecreateState(nodeId: string, containerId: string): Promise<'running' | 'created'> {
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
      const data = this.parseResult(result);
      return data?.State?.Status === 'running' ? 'running' : 'created';
    } catch {
      return 'running';
    }
  }

  private async createTask(nodeId: string, containerId: string, containerName: string, type: string) {
    if (!this.taskService) return undefined;
    const task = await this.taskService.create({ nodeId, containerId, containerName, type });
    await this.taskService.update(task.id, { status: 'running' });
    return task;
  }

  private async failTask(taskId: string | undefined, error: string, nodeId?: string, containerName?: string) {
    if (nodeId && containerName) this.clearTransition(nodeId, containerName);
    if (taskId && this.taskService) {
      await this.taskService.update(taskId, { status: 'failed', error, completedAt: new Date() }).catch(() => {});
    }
  }

  /**
   * Poll container state to detect when an async operation completes,
   * then mark the task as succeeded and clear the transition.
   */
  private watchTransition(
    nodeId: string,
    containerId: string,
    name: string,
    taskId: string | undefined,
    expectedState: string,
    progress: string,
    completedAction: ContainerAction,
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
          this.clearTransition(nodeId, name);
          if (taskId && this.taskService) {
            await this.taskService
              .update(taskId, { status: 'succeeded', progress, completedAt: new Date() })
              .catch(() => {});
          }
          this.emitContainer(nodeId, name, containerId, completedAction);
        }
      } catch {
        // Container might not exist during recreate — keep polling
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          await this.failTask(taskId, 'Timed out', nodeId, name);
        }
      }
    }, 2000);
  }

  /**
   * Poll by container NAME to detect when a recreate completes.
   * Waits for a container with the given name to appear with a DIFFERENT ID
   * and reach the expected state.
   */
  private watchRecreateByName(
    nodeId: string,
    containerName: string,
    oldContainerId: string,
    taskId: string | undefined,
    progress: string,
    expectedState: string,
    timeoutMs = 60000
  ) {
    const start = Date.now();
    const poll = setInterval(async () => {
      try {
        const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'list');
        const containers = this.parseResult(result);
        if (!Array.isArray(containers)) return;

        const match = containers.find((c: any) => {
          const cName = (c.name ?? c.Name ?? '').replace(/^\//, '');
          return cName === containerName;
        });

        if (match) {
          const newId = match.id ?? match.Id;
          const state = match.state ?? match.State ?? '';

          if (newId !== oldContainerId && state === expectedState) {
            // Recreation complete — new container reached the expected post-recreate state
            clearInterval(poll);
            this.clearTransition(nodeId, containerName);
            if (taskId && this.taskService) {
              await this.taskService
                .update(taskId, { status: 'succeeded', progress, completedAt: new Date() })
                .catch(() => {});
            }
            this.emitContainer(nodeId, containerName, newId, 'recreated', { oldId: oldContainerId });
            return;
          }
        }

        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          await this.failTask(taskId, 'Timed out', nodeId, containerName);
        }
      } catch {
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          await this.failTask(taskId, 'Timed out', nodeId, containerName);
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
    // Inject transition states into the list (looked up by name, not ID,
    // so the badge survives recreate/update which assigns a new ID).
    if (Array.isArray(containers) && this.containerTransitions.size > 0) {
      for (const c of containers) {
        const cName = ((c.name ?? c.Name ?? '') as string).replace(/^\//, '');
        if (!cName) continue;
        const transition = this.getTransition(nodeId, cName);
        if (transition) c._transition = transition;
      }
    }
    return containers;
  }

  async inspectContainer(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const data = this.parseResult(result);
    if (data) {
      const cName = ((data.Name ?? '') as string).replace(/^\//, '');
      const transition = cName ? this.getTransition(nodeId, cName) : undefined;
      if (transition) data._transition = transition;
    }
    return data;
  }

  async createContainer(nodeId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    const requestedName = (config.name as string | undefined)?.trim();
    if (requestedName) {
      await this.assertNameAvailable(nodeId, requestedName);
      this.setTransition(nodeId, requestedName, 'creating');
    }
    let data: any;
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'create', {
        configJson: JSON.stringify(config),
      });
      data = this.parseResult(result);
    } catch (err) {
      if (requestedName) this.clearTransition(nodeId, requestedName);
      this.translateNameConflict(err, requestedName || '');
    } finally {
      if (requestedName) this.clearTransition(nodeId, requestedName);
    }
    await this.auditService.log({
      action: 'docker.container.create',
      userId,
      resourceType: 'docker-container',
      details: { nodeId, name: config.name, image: config.image },
    });
    const newId = (data?.Id ?? data?.id ?? '') as string;
    if (requestedName && newId) {
      this.emitContainer(nodeId, requestedName, newId, 'created');
    }
    return data;
  }

  async startContainer(nodeId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'start', { containerId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.start',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
    this.emitContainer(nodeId, name, containerId, 'started');
  }

  async stopContainer(nodeId: string, containerId: string, timeout: number, userId: string) {
    await this.validateDockerNode(nodeId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'stopping');
    this.emitTransition(nodeId, name, containerId, 'stopping');
    const task = await this.createTask(nodeId, containerId, name, 'stop');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'stop', {
      containerId,
      timeoutSeconds: timeout,
    });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, name, task?.id, 'exited', 'Container stopped', 'stopped');
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
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'restarting');
    this.emitTransition(nodeId, name, containerId, 'restarting');
    const task = await this.createTask(nodeId, containerId, name, 'restart');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'restart', {
      containerId,
      timeoutSeconds: timeout,
    });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, name, task?.id, 'running', 'Container restarted', 'restarted');
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
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'killing');
    this.emitTransition(nodeId, name, containerId, 'killing');
    const task = await this.createTask(nodeId, containerId, name, 'kill');
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'kill', { containerId, signal });
    this.parseResult(result);
    this.watchTransition(nodeId, containerId, name, task?.id, 'exited', `Container killed (${signal})`, 'killed');
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
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'remove', { containerId, force });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.container.remove',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, force },
    });
    this.emitContainer(nodeId, name, containerId, 'removed');
  }

  async renameContainer(nodeId: string, containerId: string, newName: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const oldName = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, oldName);
    await this.assertNameAvailable(nodeId, newName);
    this.setTransition(nodeId, newName, 'creating');
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'rename', { containerId, newName });
      this.parseResult(result);
    } catch (err) {
      this.translateNameConflict(err, newName);
    } finally {
      this.clearTransition(nodeId, newName);
    }
    await this.auditService.log({
      action: 'docker.container.rename',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, name: newName },
    });
    this.emitContainer(nodeId, newName, containerId, 'renamed', { oldName });
  }

  async duplicateContainer(nodeId: string, containerId: string, name: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const sourceName = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, sourceName);
    await this.assertNameAvailable(nodeId, name);
    this.setTransition(nodeId, name, 'creating');
    let data: any;
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'duplicate', {
        containerId,
        newName: name,
      });
      data = this.parseResult(result);
    } catch (err) {
      this.translateNameConflict(err, name);
    } finally {
      this.clearTransition(nodeId, name);
    }

    // Copy secrets from source container to the new one (keyed by name)
    if (this.secretService) {
      await this.secretService.copySecrets(nodeId, sourceName, name, userId);
    }

    await this.auditService.log({
      action: 'docker.container.duplicate',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId, name },
    });
    const newId = (data?.Id ?? data?.id ?? '') as string;
    if (newId) this.emitContainer(nodeId, name, newId, 'duplicated', { sourceName });
    return data;
  }

  async updateContainer(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'updating');
    this.emitTransition(nodeId, name, containerId, 'updating');
    const task = await this.createTask(nodeId, containerId, name, 'update');
    const result = await this.nodeDispatch.sendDockerContainerCommand(
      nodeId,
      'update',
      { containerId, configJson: JSON.stringify(config) },
      120000 // 2min timeout for pull+redeploy
    );
    const data = this.parseResult(result);
    this.watchRecreateByName(nodeId, name, containerId, task?.id, 'Container updated', expectedState);
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
    const allEnv: string[] = inspect?.Config?.Env || [];

    // Strip secret keys from the env array so they only appear in the secrets section
    if (this.secretService) {
      const name = (inspect?.Name ?? '').replace(/^\//, '');
      if (name) {
        const secretKeys = await this.secretService.getSecretKeys(nodeId, name);
        if (secretKeys.size > 0) {
          return allEnv.filter((entry) => {
            const key = entry.split('=')[0];
            return !secretKeys.has(key);
          });
        }
      }
    }
    return allEnv;
  }

  async liveUpdateContainer(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'live_update', {
      containerId,
      configJson: JSON.stringify(config),
    });
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
    const name = await this.resolveContainerName(nodeId, containerId);
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'recreating');
    this.emitTransition(nodeId, name, containerId, 'recreating');
    const task = await this.createTask(nodeId, containerId, name, 'recreate');

    // Inject decrypted secrets into the recreate config's env (keyed by container name)
    if (this.secretService) {
      const secrets = await this.secretService.getDecryptedMap(nodeId, name);
      if (Object.keys(secrets).length > 0) {
        const existingEnv = (config.env as Record<string, string> | undefined) || {};
        config.env = { ...existingEnv, ...secrets };
      }
    }

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

      this.watchRecreateByName(nodeId, name, containerId, task?.id, 'Container recreated', expectedState);
      return data;
    } catch (err) {
      this.clearTransition(nodeId, name);
      if (task && this.taskService) {
        await this.taskService
          .update(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
            completedAt: new Date(),
          })
          .catch(() => {});
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
    const name = await this.resolveContainerName(nodeId, containerId);
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    this.requireNoTransition(nodeId, name);

    // Merge decrypted secrets into the env update so secrets persist across recreate
    let mergedEnv = env;
    if (this.secretService) {
      const secrets = await this.secretService.getDecryptedMap(nodeId, name);
      if (Object.keys(secrets).length > 0) {
        mergedEnv = { ...(env || {}), ...secrets };
        // Never allow removing a secret key via removeEnv
        if (removeEnv) {
          const secretKeys = new Set(Object.keys(secrets));
          removeEnv = removeEnv.filter((k) => !secretKeys.has(k));
        }
      }
    }

    this.setTransition(nodeId, name, 'updating');
    this.emitTransition(nodeId, name, containerId, 'updating');
    const task = await this.createTask(nodeId, containerId, name, 'update');
    let data: any;
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(
        nodeId,
        'update',
        { containerId, configJson: JSON.stringify({ env: mergedEnv, removeEnv }) },
        60000
      );
      data = this.parseResult(result);
    } catch (err) {
      this.clearTransition(nodeId, name);
      if (task && this.taskService) {
        await this.taskService
          .update(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
            completedAt: new Date(),
          })
          .catch(() => {});
      }
      throw err;
    }
    this.watchRecreateByName(nodeId, name, containerId, task?.id, 'Container env updated', expectedState);
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

    // Create a task and pull in background (non-blocking)
    const task = await this.createTask(nodeId, '', imageRef, 'pull');
    if (userId) {
      this.auditService
        .log({
          action: 'docker.image.pull',
          userId,
          resourceType: 'docker-image',
          details: { nodeId, imageRef },
        })
        .catch(() => {});
    }

    // Fire pull in background
    this.nodeDispatch
      .sendDockerImageCommand(nodeId, 'pull', { imageRef, registryAuthJson: registryAuth }, 300000)
      .then((result) => {
        try {
          this.parseResult(result);
        } catch (err) {
          if (task?.id && this.taskService) {
            this.taskService
              .update(task.id, {
                status: 'failed',
                error: err instanceof Error ? err.message : 'Pull failed',
                completedAt: new Date(),
              })
              .catch(() => {});
          }
          return;
        }
        if (task?.id && this.taskService) {
          this.taskService
            .update(task.id, { status: 'succeeded', progress: `Pulled ${imageRef}`, completedAt: new Date() })
            .catch(() => {});
        }
        this.emitImage(nodeId, imageRef, 'pulled');
      })
      .catch((err) => {
        if (task?.id && this.taskService) {
          this.taskService
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
    this.emitImage(nodeId, imageId, 'removed');
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
    this.emitImage(nodeId, '*', 'pruned');
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
    this.emitVolume(nodeId, config.name, 'created');
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
    this.emitVolume(nodeId, name, 'removed');
  }

  // ─── Network operations ────────────────────────────────────────────

  async listNetworks(nodeId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'list');
    return this.parseResult(result);
  }

  private isBuiltInDockerNetwork(name: string) {
    return ['bridge', 'host', 'none'].includes(name);
  }

  private async resolveNetworkName(nodeId: string, networkId: string) {
    const networks = await this.listNetworks(nodeId);
    if (!Array.isArray(networks)) return networkId;

    const match = networks.find((network: any) => {
      const id = String(network.id ?? network.Id ?? '');
      const name = String(network.name ?? network.Name ?? '');
      return id === networkId || name === networkId;
    });

    return String(match?.name ?? match?.Name ?? networkId);
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
    this.emitNetwork(nodeId, config.name, 'created');
    return data;
  }

  async removeNetwork(nodeId: string, networkId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const networkName = await this.resolveNetworkName(nodeId, networkId);
    if (this.isBuiltInDockerNetwork(networkName)) {
      throw new AppError(400, 'BUILTIN_NETWORK', 'Built-in Docker networks cannot be removed');
    }
    const result = await this.nodeDispatch.sendDockerNetworkCommand(nodeId, 'remove', { networkId });
    this.parseResult(result);
    await this.auditService.log({
      action: 'docker.network.remove',
      userId,
      resourceType: 'docker-network',
      resourceId: networkId,
      details: { nodeId },
    });
    this.emitNetwork(nodeId, networkId, 'removed');
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
    const networkName = await this.resolveNetworkName(nodeId, networkId);
    if (this.isBuiltInDockerNetwork(networkName)) {
      throw new AppError(400, 'BUILTIN_NETWORK', 'Containers cannot be disconnected from built-in Docker networks');
    }
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
