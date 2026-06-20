import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerDeployments, nodes } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { assertNodeAllowsServiceCreation } from '@/modules/nodes/service-creation-lock.js';
import type { NotificationEvaluatorService } from '@/modules/notifications/notification-evaluator.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { DockerDeploymentService } from './docker-deployment.service.js';
import { DOCKER_DEPLOYMENT_MANAGED_LABEL } from './docker-deployment.service.js';
import type { DockerEnvironmentService } from './docker-environment.service.js';
import type { DockerFolderService } from './docker-folder.service.js';
import type { DockerHealthCheckService } from './docker-health-check.service.js';
import type { DockerImageCleanupService } from './docker-image-cleanup.service.js';
import {
  listImages as listDockerImages,
  pruneImages as pruneDockerImages,
  pullImage as pullDockerImage,
  removeImage as removeDockerImage,
} from './docker-image-operations.js';
import {
  getContainerLogs as getDockerContainerLogs,
  getContainerStats as getDockerContainerStats,
  getContainerTop as getDockerContainerTop,
  listDirectory as listDockerDirectory,
  readFile as readDockerFile,
  writeFile as writeDockerFile,
} from './docker-read-operations.js';
import { dockerDispatchErrorMessage, getReplacementContainerFailureMessage } from './docker-recreate-watch.js';
import type { DockerRegistryAuthCandidate, DockerRegistryService } from './docker-registry.service.js';
import { applyRuntimeSettingsToInspect } from './docker-runtime-inspect.js';
import {
  type ContainerRuntimeConfig,
  type NodeRuntimeCapacity,
  validateContainerRuntimeLimits,
} from './docker-runtime-limits.js';
import type { DockerRuntimeSettingsService } from './docker-runtime-settings.service.js';
import type { DockerSecretService } from './docker-secret.service.js';
import { assertDockerMountChangeAllowed, normalizeMountDefinitionsFromInspect } from './docker-socket-mount.guard.js';
import type { DockerTaskService } from './docker-task.service.js';
import {
  connectContainerToNetwork as connectDockerContainerToNetwork,
  createNetwork as createDockerNetwork,
  createVolume as createDockerVolume,
  disconnectContainerFromNetwork as disconnectDockerContainerFromNetwork,
  listNetworks as listDockerNetworks,
  listVolumes as listDockerVolumes,
  removeNetwork as removeDockerNetwork,
  removeVolume as removeDockerVolume,
} from './docker-volume-network-operations.js';

const logger = createChildLogger('DockerManagementService');
const DEFAULT_CONTAINER_STOP_TIMEOUT_SECONDS = 20;
const CONTAINER_LIFECYCLE_TIMEOUT_BUFFER_SECONDS = 30;

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
  private static readonly LONG_DOCKER_OPERATION_TIMEOUT_MS = 600000; // 10 minutes

  /**
   * `${nodeId}:${containerName}` → current transition state.
   * Keyed by name (not ID) so the badge survives recreate/update, which
   * destroy the old container and create a new one with a different ID.
   */
  private containerTransitions = new Map<string, ContainerTransition>();

  private taskService?: DockerTaskService;
  private environmentService?: DockerEnvironmentService;
  private runtimeSettingsService?: DockerRuntimeSettingsService;
  private secretService?: DockerSecretService;
  private folderService?: DockerFolderService;
  private deploymentService?: DockerDeploymentService;
  private healthCheckService?: DockerHealthCheckService;
  private registryService?: DockerRegistryService;
  private imageCleanupService?: DockerImageCleanupService;
  private eventBus?: EventBusService;
  private evaluator?: NotificationEvaluatorService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private nodeDispatch: NodeDispatchService,
    private nodeRegistry: NodeRegistryService
  ) {}

  setTaskService(taskService: DockerTaskService) {
    this.taskService = taskService;
  }

  setEnvironmentService(environmentService: DockerEnvironmentService) {
    this.environmentService = environmentService;
  }

  setRuntimeSettingsService(runtimeSettingsService: DockerRuntimeSettingsService) {
    this.runtimeSettingsService = runtimeSettingsService;
  }

  setSecretService(secretService: DockerSecretService) {
    this.secretService = secretService;
  }

  setFolderService(folderService: DockerFolderService) {
    this.folderService = folderService;
  }

  setDeploymentService(deploymentService: DockerDeploymentService) {
    this.deploymentService = deploymentService;
  }

  setHealthCheckService(healthCheckService: DockerHealthCheckService) {
    this.healthCheckService = healthCheckService;
  }

  setRegistryService(registryService: DockerRegistryService) {
    this.registryService = registryService;
  }

  setImageCleanupService(imageCleanupService: DockerImageCleanupService) {
    this.imageCleanupService = imageCleanupService;
  }

  setEventBus(eventBus: EventBusService) {
    this.eventBus = eventBus;
  }

  setEvaluator(evaluator: NotificationEvaluatorService) {
    this.evaluator = evaluator;
  }

  private emitContainer(
    nodeId: string,
    name: string,
    id: string,
    action: ContainerAction,
    extra?: Record<string, unknown>
  ) {
    this.eventBus?.publish('docker.container.changed', { nodeId, name, id, action, ...(extra || {}) });
    this.observeContainerLifecycle(nodeId, name, id, action, extra);
  }

  emitTransition(nodeId: string, name: string, id: string, transition: ContainerTransition) {
    this.eventBus?.publish('docker.container.changed', { nodeId, name, id, action: 'transitioning', transition });
  }

  private observeContainerLifecycle(
    nodeId: string,
    name: string,
    id: string,
    action: ContainerAction,
    extra?: Record<string, unknown>
  ) {
    const state = this.lifecycleStateForAction(action);
    if (!state) return;

    const observedPatterns = state === 'started' || state === 'removed' ? ['stopped', 'exited'] : [state];
    this.evaluator
      ?.observeStatefulEvent(
        'container',
        state,
        { type: 'container', id: name || id, name: name || id },
        { nodeId, containerId: id, action, ...(extra || {}) },
        observedPatterns
      )
      .catch((error) => {
        logger.debug('Container lifecycle stateful event observation failed', {
          nodeId,
          containerId: id,
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private lifecycleStateForAction(action: ContainerAction): 'started' | 'stopped' | 'exited' | 'removed' | null {
    switch (action) {
      case 'started':
      case 'restarted':
      case 'recreated':
        return 'started';
      case 'stopped':
        return 'stopped';
      case 'killed':
        return 'exited';
      case 'removed':
        return 'removed';
      default:
        return null;
    }
  }

  private imageOperationContext() {
    return {
      nodeDispatch: this.nodeDispatch,
      auditService: this.auditService,
      taskService: this.taskService,
      registryService: this.registryService,
      eventBus: this.eventBus,
      parseResult: (result: { success: boolean; error?: string; detail?: string }) => this.parseResult(result),
      createTask: (nodeId: string, containerId: string, containerName: string, type: string) =>
        this.createTask(nodeId, containerId, containerName, type),
      longDockerOperationTimeoutMs: DockerManagementService.LONG_DOCKER_OPERATION_TIMEOUT_MS,
    };
  }

  private volumeNetworkOperationContext() {
    return {
      nodeDispatch: this.nodeDispatch,
      auditService: this.auditService,
      eventBus: this.eventBus,
      parseResult: (result: { success: boolean; error?: string; detail?: string }) => this.parseResult(result),
    };
  }

  private readOperationContext() {
    return {
      nodeDispatch: this.nodeDispatch,
      auditService: this.auditService,
      parseResult: (result: { success: boolean; error?: string; detail?: string }) => this.parseResult(result),
    };
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
    const [deployment] = await this.db
      .select({ id: dockerDeployments.id })
      .from(dockerDeployments)
      .where(and(eq(dockerDeployments.nodeId, nodeId), eq(dockerDeployments.name, name)))
      .limit(1);
    if (deployment) {
      throw new AppError(409, 'NAME_IN_USE', `A deployment named "${name}" already exists on this node`);
    }
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'list');
      const containers = this.parseResult(result);
      if (Array.isArray(containers)) {
        const collision = containers.some((c: any) => {
          if (this.isManagedDeploymentInternal(c)) return false;
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

  private isManagedDeploymentInternal(data: any): boolean {
    const labels = data?.Config?.Labels ?? data?.Labels ?? data?.labels ?? {};
    return labels?.[DOCKER_DEPLOYMENT_MANAGED_LABEL] === 'true';
  }

  private async assertNotManagedDeploymentInternal(nodeId: string, containerId: string) {
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const data = this.parseResult(result);
    if (this.isManagedDeploymentInternal(data)) {
      throw new AppError(
        409,
        'MANAGED_DEPLOYMENT_CONTAINER',
        'This container is managed by a blue/green deployment. Use deployment actions instead.'
      );
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
    if (nodeId && containerName) {
      this.eventBus?.publish('docker.container.changed', {
        nodeId,
        name: containerName,
        action: 'transitioning',
        transition: null,
      });
    }
    if (taskId && this.taskService) {
      await this.taskService.update(taskId, { status: 'failed', error, completedAt: new Date() }).catch(() => {});
    }
  }

  private normalizePositiveNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private normalizeNonNegativeNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private async getNodeRuntimeCapacity(nodeId: string): Promise<NodeRuntimeCapacity> {
    const [row] = await this.db
      .select({
        capabilities: nodes.capabilities,
        lastHealthReport: nodes.lastHealthReport,
      })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Node not found');
    }

    const liveHealth = this.nodeRegistry.getNode(nodeId)?.lastHealthReport ?? row.lastHealthReport ?? null;
    const capabilities = (row.capabilities ?? {}) as Record<string, unknown>;

    return {
      cpuCores: this.normalizePositiveNumber(capabilities.cpuCores),
      memoryBytes: this.normalizePositiveNumber(liveHealth?.systemMemoryTotalBytes),
      swapBytes: this.normalizeNonNegativeNumber(liveHealth?.swapTotalBytes),
    };
  }

  private async getCurrentRuntimeConfig(nodeId: string, containerId: string): Promise<ContainerRuntimeConfig> {
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const data = this.parseResult(result);
    const hostConfig = (data?.HostConfig ?? {}) as Record<string, unknown>;

    return {
      memoryLimit: this.normalizeNonNegativeNumber(hostConfig.Memory) ?? 0,
      memorySwap: hostConfig.MemorySwap === -1 ? -1 : (this.normalizeNonNegativeNumber(hostConfig.MemorySwap) ?? 0),
      nanoCPUs: this.normalizeNonNegativeNumber(hostConfig.NanoCPUs) ?? 0,
      cpuQuota: this.normalizeNonNegativeNumber(hostConfig.CPUQuota) ?? 0,
      cpuPeriod: this.normalizeNonNegativeNumber(hostConfig.CPUPeriod) ?? 0,
    };
  }

  private extractRuntimeConfig(config: Record<string, unknown>): ContainerRuntimeConfig {
    return {
      restartPolicy:
        typeof config.restartPolicy === 'string'
          ? (config.restartPolicy as ContainerRuntimeConfig['restartPolicy'])
          : undefined,
      maxRetries: typeof config.maxRetries === 'number' ? config.maxRetries : undefined,
      memoryLimit: typeof config.memoryLimit === 'number' ? config.memoryLimit : undefined,
      memorySwap: typeof config.memorySwap === 'number' ? config.memorySwap : undefined,
      nanoCPUs: typeof config.nanoCPUs === 'number' ? config.nanoCPUs : undefined,
      cpuShares: typeof config.cpuShares === 'number' ? config.cpuShares : undefined,
      pidsLimit: typeof config.pidsLimit === 'number' ? config.pidsLimit : undefined,
    };
  }

  private normalizeRuntimeConfig(config: ContainerRuntimeConfig): ContainerRuntimeConfig {
    const normalized: ContainerRuntimeConfig = {};
    if (config.restartPolicy && config.restartPolicy !== 'no') {
      normalized.restartPolicy = config.restartPolicy;
    }
    if ((config.maxRetries ?? 0) > 0) {
      normalized.maxRetries = config.maxRetries;
    }
    if ((config.memoryLimit ?? 0) > 0) {
      normalized.memoryLimit = config.memoryLimit;
    }
    if (config.memorySwap === -1 || (config.memorySwap ?? 0) > 0) {
      normalized.memorySwap = config.memorySwap;
    }
    if ((config.nanoCPUs ?? 0) > 0) {
      normalized.nanoCPUs = config.nanoCPUs;
    }
    if ((config.cpuShares ?? 0) > 0) {
      normalized.cpuShares = config.cpuShares;
    }
    if ((config.pidsLimit ?? 0) > 0) {
      normalized.pidsLimit = config.pidsLimit;
    }
    return normalized;
  }

  private mergeRuntimeConfig(base: ContainerRuntimeConfig, patch: ContainerRuntimeConfig): ContainerRuntimeConfig {
    return this.normalizeRuntimeConfig({
      restartPolicy: patch.restartPolicy ?? base.restartPolicy,
      maxRetries: patch.maxRetries ?? base.maxRetries,
      memoryLimit: patch.memoryLimit ?? base.memoryLimit,
      memorySwap: patch.memorySwap ?? base.memorySwap,
      nanoCPUs: patch.nanoCPUs ?? base.nanoCPUs,
      cpuShares: patch.cpuShares ?? base.cpuShares,
      pidsLimit: patch.pidsLimit ?? base.pidsLimit,
    });
  }

  private async persistRuntimeSettings(
    nodeId: string,
    containerName: string,
    patch: Record<string, unknown>
  ): Promise<ContainerRuntimeConfig | null> {
    if (!this.runtimeSettingsService) return null;

    const incoming = this.extractRuntimeConfig(patch);
    if (Object.values(incoming).every((value) => value === undefined)) {
      return await this.runtimeSettingsService.get(nodeId, containerName);
    }

    const existing = (await this.runtimeSettingsService.get(nodeId, containerName)) ?? {};
    const merged = this.mergeRuntimeConfig(existing, incoming);
    await this.runtimeSettingsService.replace(nodeId, containerName, merged);
    return Object.keys(merged).length > 0 ? merged : null;
  }

  private async applyPersistedRuntimeSettingsToConfig(
    nodeId: string,
    containerName: string,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const persisted = await this.persistRuntimeSettings(nodeId, containerName, config);
    if (!persisted) return config;
    return { ...persisted, ...config };
  }

  private applyRuntimeSettingsToInspect(
    inspect: Record<string, any>,
    config: ContainerRuntimeConfig | null
  ): Record<string, any> {
    return applyRuntimeSettingsToInspect(inspect, config);
  }

  private async validateRuntimeResourceConfig(nodeId: string, containerId: string, config: Record<string, unknown>) {
    const resourceConfig: ContainerRuntimeConfig = {
      memoryLimit: typeof config.memoryLimit === 'number' ? config.memoryLimit : undefined,
      memorySwap: typeof config.memorySwap === 'number' ? config.memorySwap : undefined,
      nanoCPUs: typeof config.nanoCPUs === 'number' ? config.nanoCPUs : undefined,
    };

    if (
      resourceConfig.memoryLimit === undefined &&
      resourceConfig.memorySwap === undefined &&
      resourceConfig.nanoCPUs === undefined
    ) {
      return;
    }

    const [capacity, current] = await Promise.all([
      this.getNodeRuntimeCapacity(nodeId),
      this.getCurrentRuntimeConfig(nodeId, containerId),
    ]);

    validateContainerRuntimeLimits(resourceConfig, current, capacity);
  }

  private async resolveContainerStopTimeout(nodeId: string, containerId: string, timeout: number | undefined) {
    if (timeout !== undefined) return timeout;

    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
      const data = this.parseResult(result);
      const configuredRaw = data?.Config?.StopTimeout;
      const configured = typeof configuredRaw === 'number' ? configuredRaw : Number.NaN;
      if (Number.isInteger(configured) && configured >= 0) return configured;
    } catch {
      // Fall through to Gateway default if inspect fails; the lifecycle command will report its own error.
    }

    return DEFAULT_CONTAINER_STOP_TIMEOUT_SECONDS;
  }

  private lifecycleWatchTimeoutMs(
    stopTimeoutSeconds: number,
    bufferSeconds = CONTAINER_LIFECYCLE_TIMEOUT_BUFFER_SECONDS
  ) {
    return Math.max(60000, (stopTimeoutSeconds + bufferSeconds) * 1000);
  }

  private resolveStopTimeoutFromInspect(inspect: Record<string, any>, config?: Record<string, unknown>) {
    const configRaw = config?.stopTimeout;
    const configValue = typeof configRaw === 'number' ? configRaw : Number.NaN;
    if (Number.isInteger(configValue) && configValue >= 0) return configValue;

    const inspectRaw = inspect?.Config?.StopTimeout;
    const inspectValue = typeof inspectRaw === 'number' ? inspectRaw : Number.NaN;
    if (Number.isInteger(inspectValue) && inspectValue >= 0) return inspectValue;

    return DEFAULT_CONTAINER_STOP_TIMEOUT_SECONDS;
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
    timeoutMs = 60000,
    isComplete?: (inspectData: Record<string, any>) => boolean
  ) {
    const start = Date.now();
    const poll = setInterval(async () => {
      try {
        const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
        const data = this.parseResult(result);
        const state = data?.State?.Status;
        const completed = isComplete ? isComplete(data) : state === expectedState;
        if (completed) {
          clearInterval(poll);
          this.clearTransition(nodeId, name);
          if (taskId && this.taskService) {
            await this.taskService
              .update(taskId, { status: 'succeeded', progress, completedAt: new Date() })
              .catch(() => {});
          }
          this.emitContainer(nodeId, name, containerId, completedAction);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          await this.failTask(taskId, 'Timed out', nodeId, name);
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

          const replacementFailure = getReplacementContainerFailureMessage(match, oldContainerId, expectedState);
          if (replacementFailure) {
            clearInterval(poll);
            await this.failTask(taskId, replacementFailure, nodeId, containerName);
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
      throw new AppError(502, 'DISPATCH_ERROR', dockerDispatchErrorMessage(result, 'Command failed on daemon'));
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
    const folderAssignments =
      Array.isArray(containers) && this.folderService
        ? await this.folderService.syncNodeContainers(nodeId, containers as any[])
        : [];
    const folderByName = new Map(folderAssignments.map((item) => [item.containerName, item]));
    // Inject transition states into the list (looked up by name, not ID,
    // so the badge survives recreate/update which assigns a new ID).
    if (Array.isArray(containers)) {
      const visibleContainers = containers.filter((c: any) => !this.isManagedDeploymentInternal(c));
      const containerHealth =
        this.healthCheckService && visibleContainers.length > 0
          ? await this.healthCheckService.getRowsForContainers(
              nodeId,
              visibleContainers.map((c: any) => ((c.name ?? c.Name ?? '') as string).replace(/^\//, '')).filter(Boolean)
            )
          : new Map();
      for (const c of visibleContainers) {
        const cName = ((c.name ?? c.Name ?? '') as string).replace(/^\//, '');
        if (!cName) continue;
        const folder = folderByName.get(cName);
        if (folder) {
          c.folderId = folder.folderId;
          c.folderIsSystem = folder.folderIsSystem;
          c.folderSortOrder = folder.sortOrder;
        } else {
          c.folderId = null;
          c.folderIsSystem = false;
          c.folderSortOrder = 0;
        }
        const transition = this.getTransition(nodeId, cName);
        if (transition) c._transition = transition;
        const health = containerHealth.get(cName);
        if (health) {
          c.healthCheckId = health.id;
          c.healthCheckEnabled = health.enabled;
          c.healthStatus = health.healthStatus;
          c.lastHealthCheckAt = health.lastHealthCheckAt;
        }
      }
      if (this.deploymentService) {
        const deploymentRows = await this.deploymentService.syntheticRows(nodeId);
        const deploymentHealth = this.healthCheckService
          ? await this.healthCheckService.getRowsForDeployments(
              deploymentRows.map((deployment: any) => deployment.deploymentId ?? deployment.id)
            )
          : new Map();
        if (this.folderService && deploymentRows.length > 0) {
          const placements = await this.folderService.getPlacementsForRefs(
            deploymentRows.map((deployment: any) => ({
              nodeId,
              containerName: deployment.name,
            }))
          );
          const placementByName = new Map(placements.map((placement) => [placement.containerName, placement]));
          for (const deployment of deploymentRows as any[]) {
            const placement = placementByName.get(deployment.name);
            if (!placement) continue;
            deployment.folderId = placement.folderId;
            deployment.folderIsSystem = placement.folderIsSystem;
            deployment.folderSortOrder = placement.sortOrder;
          }
        }
        for (const deployment of deploymentRows as any[]) {
          const health = deploymentHealth.get(deployment.deploymentId ?? deployment.id);
          if (!health) continue;
          deployment.healthCheckId = health.id;
          deployment.healthCheckEnabled = health.enabled;
          deployment.healthStatus = health.healthStatus;
          deployment.lastHealthCheckAt = health.lastHealthCheckAt;
        }
        visibleContainers.push(...deploymentRows);
      }
      return visibleContainers;
    }
    return containers;
  }

  async inspectContainer(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const data = this.parseResult(result);
    if (data) {
      const cName = ((data.Name ?? '') as string).replace(/^\//, '');
      if (this.secretService && cName && Array.isArray(data?.Config?.Env)) {
        const secretKeys = await this.secretService.getSecretKeys(nodeId, cName);
        if (secretKeys.size > 0) {
          data.Config.Env = data.Config.Env.map((entry: string) => {
            const eqIndex = entry.indexOf('=');
            if (eqIndex === -1) return entry;
            const key = entry.slice(0, eqIndex);
            return secretKeys.has(key) ? `${key}=********` : entry;
          });
        }
      }
      const transition = cName ? this.getTransition(nodeId, cName) : undefined;
      if (transition) data._transition = transition;
      if (this.runtimeSettingsService && cName) {
        const persistedRuntime = await this.runtimeSettingsService.get(nodeId, cName);
        if (persistedRuntime) {
          return this.applyRuntimeSettingsToInspect(data, persistedRuntime);
        }
      }
    }
    return data;
  }

  async createContainer(nodeId: string, config: Record<string, unknown>, userId: string, actorScopes: string[] = []) {
    await assertNodeAllowsServiceCreation(this.db, nodeId, 'docker');
    await this.validateDockerNode(nodeId);
    assertDockerMountChangeAllowed({ nodeId, actorScopes, nextConfig: config, currentDefinitions: [] });
    const registryId = typeof config.registryId === 'string' ? config.registryId : null;
    delete config.registryId;
    const requestedName = (config.name as string | undefined)?.trim();
    if (requestedName) {
      await this.assertNameAvailable(nodeId, requestedName);
      this.setTransition(nodeId, requestedName, 'creating');
    }
    let data: any;
    try {
      if (registryId) {
        await this.pullConfigImage(nodeId, config, registryId);
      }
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
    const createdName = (requestedName || data?.name || data?.Name || '') as string;
    const newId = (data?.Id ?? data?.id ?? '') as string;
    if (createdName && this.environmentService) {
      const env = this.normalizeEnvRecord(config.env);
      if (env) {
        await this.environmentService.replace(nodeId, createdName, env);
      }
    }
    if (typeof config.image === 'string') {
      await this.registryService?.rememberImageRegistry?.(nodeId, config.image, registryId);
    }
    if (requestedName && newId) {
      this.emitContainer(nodeId, requestedName, newId, 'created');
    }
    return data;
  }

  async startContainer(nodeId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    if (this.runtimeSettingsService) {
      const persistedRuntime = await this.runtimeSettingsService.get(nodeId, name);
      if (persistedRuntime) {
        await this.validateRuntimeResourceConfig(nodeId, containerId, persistedRuntime as Record<string, unknown>);
        const updateResult = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'live_update', {
          containerId,
          configJson: JSON.stringify(persistedRuntime),
        });
        this.parseResult(updateResult);
      }
    }
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

  async stopContainer(nodeId: string, containerId: string, timeout: number | undefined, userId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const stopTimeout = await this.resolveContainerStopTimeout(nodeId, containerId, timeout);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'stopping');
    this.emitTransition(nodeId, name, containerId, 'stopping');
    const task = await this.createTask(nodeId, containerId, name, 'stop');
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'stop', {
        containerId,
        timeoutSeconds: stopTimeout,
        configJson: JSON.stringify({ timeoutProvided: true }),
      });
      this.parseResult(result);
    } catch (err) {
      await this.failTask(task?.id, err instanceof Error ? err.message : 'Failed to stop container', nodeId, name);
      throw err;
    }
    this.watchTransition(
      nodeId,
      containerId,
      name,
      task?.id,
      'exited',
      'Container stopped',
      'stopped',
      this.lifecycleWatchTimeoutMs(stopTimeout)
    );
    await this.auditService.log({
      action: 'docker.container.stop',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async restartContainer(nodeId: string, containerId: string, timeout: number | undefined, userId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const stopTimeout = await this.resolveContainerStopTimeout(nodeId, containerId, timeout);
    let previousStartedAt: string | undefined;
    try {
      const inspectResult = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
      previousStartedAt = this.parseResult(inspectResult)?.State?.StartedAt;
    } catch {
      previousStartedAt = undefined;
    }
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'restarting');
    this.emitTransition(nodeId, name, containerId, 'restarting');
    const task = await this.createTask(nodeId, containerId, name, 'restart');
    try {
      if (this.runtimeSettingsService) {
        const persistedRuntime = await this.runtimeSettingsService.get(nodeId, name);
        if (persistedRuntime) {
          await this.validateRuntimeResourceConfig(nodeId, containerId, persistedRuntime as Record<string, unknown>);
          const updateResult = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'live_update', {
            containerId,
            configJson: JSON.stringify(persistedRuntime),
          });
          this.parseResult(updateResult);
        }
      }
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'restart', {
        containerId,
        timeoutSeconds: stopTimeout,
        configJson: JSON.stringify({ timeoutProvided: true }),
      });
      this.parseResult(result);
    } catch (err) {
      await this.failTask(task?.id, err instanceof Error ? err.message : 'Failed to restart container', nodeId, name);
      throw err;
    }
    this.watchTransition(
      nodeId,
      containerId,
      name,
      task?.id,
      'running',
      'Container restarted',
      'restarted',
      this.lifecycleWatchTimeoutMs(stopTimeout, 60),
      (data) => {
        const state = data?.State;
        return state?.Status === 'running' && (!previousStartedAt || state.StartedAt !== previousStartedAt);
      }
    );
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
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'killing');
    this.emitTransition(nodeId, name, containerId, 'killing');
    const task = await this.createTask(nodeId, containerId, name, 'kill');
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'kill', { containerId, signal });
      this.parseResult(result);
    } catch (err) {
      await this.failTask(task?.id, err instanceof Error ? err.message : 'Failed to kill container', nodeId, name);
      throw err;
    }
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
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
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
    if (this.folderService) {
      await this.folderService.deleteContainerAssignment(nodeId, name);
    }
    if (this.runtimeSettingsService) {
      await this.runtimeSettingsService.delete(nodeId, name);
    }
    this.emitContainer(nodeId, name, containerId, 'removed');
  }

  async renameContainer(nodeId: string, containerId: string, newName: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
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
    if (this.environmentService) {
      await this.environmentService.rename(nodeId, oldName, newName);
    }
    if (this.runtimeSettingsService) {
      await this.runtimeSettingsService.rename(nodeId, oldName, newName);
    }
    if (this.folderService) {
      await this.folderService.renameContainerAssignment(nodeId, oldName, newName);
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

  async duplicateContainer(
    nodeId: string,
    containerId: string,
    name: string,
    userId: string,
    actorScopes: string[] = []
  ) {
    await assertNodeAllowsServiceCreation(this.db, nodeId, 'docker');
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const sourceName = await this.resolveContainerName(nodeId, containerId);
    const inspect = await this.inspectContainer(nodeId, containerId);
    assertDockerMountChangeAllowed({
      nodeId,
      actorScopes,
      currentDefinitions: [],
      nextDefinitions: normalizeMountDefinitionsFromInspect(inspect),
    });
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
    if (this.environmentService) {
      await this.environmentService.copy(nodeId, sourceName, name);
    }
    if (this.runtimeSettingsService) {
      await this.runtimeSettingsService.copy(nodeId, sourceName, name);
    }
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

  async updateContainer(
    nodeId: string,
    containerId: string,
    config: Record<string, unknown>,
    userId: string,
    actorScopes: string[] = []
  ) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const inspect = await this.inspectContainer(nodeId, containerId);
    assertDockerMountChangeAllowed({
      nodeId,
      actorScopes,
      nextConfig: config,
      currentInspect: inspect,
      useCurrentWhenNextMissing: true,
    });
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    if (this.environmentService) {
      const storedEnv = await this.environmentService.getDecryptedMap(nodeId, name);
      if (Object.keys(storedEnv).length > 0) {
        config.env = { ...storedEnv, ...(this.normalizeEnvRecord(config.env) || {}) };
      }
    }
    if (this.secretService) {
      const secrets = await this.secretService.getDecryptedMap(nodeId, name);
      if (Object.keys(secrets).length > 0) {
        config.env = { ...(this.normalizeEnvRecord(config.env) || {}), ...secrets };
      }
    }
    config = await this.applyPersistedRuntimeSettingsToConfig(nodeId, name, config);
    const hasImageChange = typeof config.tag === 'string' && config.tag.length > 0;
    const updateStopTimeout = this.resolveStopTimeoutFromInspect(inspect as Record<string, any>, config);
    const updateTimeoutMs = hasImageChange
      ? DockerManagementService.LONG_DOCKER_OPERATION_TIMEOUT_MS
      : Math.max(120000, this.lifecycleWatchTimeoutMs(updateStopTimeout, 60));
    this.requireNoTransition(nodeId, name);
    this.setTransition(nodeId, name, 'updating');
    this.emitTransition(nodeId, name, containerId, 'updating');
    const task = await this.createTask(nodeId, containerId, name, 'update');
    let data: any;
    try {
      const result = await this.nodeDispatch.sendDockerContainerCommand(
        nodeId,
        'update',
        { containerId, configJson: JSON.stringify(config) },
        updateTimeoutMs
      );
      data = this.parseResult(result);
    } catch (err) {
      await this.failTask(task?.id, err instanceof Error ? err.message : 'Failed to update container', nodeId, name);
      throw err;
    }
    this.watchRecreateByName(nodeId, name, containerId, task?.id, 'Container updated', expectedState, updateTimeoutMs);
    await this.auditService.log({
      action: 'docker.container.update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
    if (hasImageChange) {
      const imageRef = this.imageRefWithTag(inspect?.Config?.Image ?? inspect?.Image, config.tag as string);
      this.imageCleanupService?.scheduleCleanupForContainer(nodeId, name, imageRef).catch(() => {});
    }
    return data;
  }

  async getContainerLogs(nodeId: string, containerId: string, tail: number, timestamps: boolean) {
    await this.validateDockerNode(nodeId);
    return getDockerContainerLogs(this.readOperationContext(), nodeId, containerId, tail, timestamps);
  }

  async getContainerEnv(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId });
    const inspect = this.parseResult(result);
    const allEnv: string[] = inspect?.Config?.Env || [];
    const name = (inspect?.Name ?? '').replace(/^\//, '');

    // Strip secret keys from the env array so they only appear in the secrets section
    let visibleEnv = allEnv;
    if (this.secretService) {
      if (name) {
        const secretKeys = await this.secretService.getSecretKeys(nodeId, name);
        if (secretKeys.size > 0) {
          visibleEnv = allEnv.filter((entry) => {
            const key = entry.split('=')[0];
            return !secretKeys.has(key);
          });
        }
      }
    }

    if (this.environmentService && name) {
      const storedEnv = await this.environmentService.getDecryptedMap(nodeId, name);
      if (Object.keys(storedEnv).length > 0) {
        return this.envMapToList(storedEnv);
      }

      await this.environmentService.seedFromRuntimeIfMissing(nodeId, name, this.envListToMap(visibleEnv));
    }

    return visibleEnv;
  }

  async liveUpdateContainer(nodeId: string, containerId: string, config: Record<string, unknown>, userId: string) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    await this.persistRuntimeSettings(nodeId, name, config);
    const inspect = await this.inspectContainer(nodeId, containerId);
    const state = (inspect?.State?.Status ?? '') as string;
    if (state === 'running') {
      await this.validateRuntimeResourceConfig(nodeId, containerId, config);
      const result = await this.nodeDispatch.sendDockerContainerCommand(nodeId, 'live_update', {
        containerId,
        configJson: JSON.stringify(config),
      });
      this.parseResult(result);
    }
    await this.auditService.log({
      action: 'docker.container.live_update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });
  }

  async recreateWithConfig(
    nodeId: string,
    containerId: string,
    config: Record<string, unknown>,
    userId: string,
    options?: { skipImagePull?: boolean; skipWebhookCleanup?: boolean; actorScopes?: string[] }
  ) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    this.requireNoTransition(nodeId, name);
    config = await this.applyPersistedRuntimeSettingsToConfig(nodeId, name, config);
    const inspect = await this.inspectContainer(nodeId, containerId);
    const recreateStopTimeout = this.resolveStopTimeoutFromInspect(inspect as Record<string, any>, config);
    assertDockerMountChangeAllowed({
      nodeId,
      actorScopes: options?.actorScopes ?? [],
      nextConfig: config,
      currentInspect: inspect,
      useCurrentWhenNextMissing: true,
    });
    await this.validateRuntimeResourceConfig(nodeId, containerId, config);
    this.setTransition(nodeId, name, 'recreating');
    this.emitTransition(nodeId, name, containerId, 'recreating');
    const task = await this.createTask(nodeId, containerId, name, 'recreate');

    // Inject decrypted secrets into the recreate config's env (keyed by container name)
    if (this.environmentService) {
      const storedEnv = await this.environmentService.getDecryptedMap(nodeId, name);
      if (Object.keys(storedEnv).length > 0) {
        const existingEnv = (config.env as Record<string, string> | undefined) || {};
        config.env = { ...storedEnv, ...existingEnv };
      }
    }

    if (this.secretService) {
      const secrets = await this.secretService.getDecryptedMap(nodeId, name);
      if (Object.keys(secrets).length > 0) {
        const existingEnv = (config.env as Record<string, string> | undefined) || {};
        config.env = { ...existingEnv, ...secrets };
      }
    }

    try {
      if (!options?.skipImagePull) {
        await this.pullConfigImage(nodeId, config);
      }

      const result = await this.nodeDispatch.sendDockerContainerCommand(
        nodeId,
        'recreate',
        { containerId, configJson: JSON.stringify(config) },
        Math.max(120000, this.lifecycleWatchTimeoutMs(recreateStopTimeout, 60))
      );
      const data = this.parseResult(result);
      await this.auditService.log({
        action: 'docker.container.recreate',
        userId,
        resourceType: 'docker-container',
        resourceId: containerId,
        details: { nodeId },
      });
      if (!options?.skipWebhookCleanup && typeof config.image === 'string') {
        this.imageCleanupService?.scheduleCleanupForContainer(nodeId, name, config.image).catch(() => {});
      }

      this.watchRecreateByName(
        nodeId,
        name,
        containerId,
        task?.id,
        'Container recreated',
        expectedState,
        this.lifecycleWatchTimeoutMs(recreateStopTimeout, 60)
      );
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

  private async pullConfigImage(nodeId: string, config: Record<string, unknown>, registryId?: string) {
    const imageRef = typeof config.image === 'string' ? config.image.trim() : '';
    if (!imageRef) return;

    const authCandidates =
      (await this.registryService?.resolveAuthCandidatesForImagePull(nodeId, imageRef, registryId)) ?? [];
    const pullCandidates: Array<DockerRegistryAuthCandidate | null> = authCandidates.length ? authCandidates : [null];
    let lastError: unknown;

    for (const auth of pullCandidates) {
      let finalImageRef = imageRef;
      if (auth && !this.hasRegistryHost(imageRef)) {
        finalImageRef = `${auth.url}/${imageRef}`;
      }

      try {
        const result = await this.nodeDispatch.sendDockerImageCommand(
          nodeId,
          'pull',
          { imageRef: finalImageRef, registryAuthJson: auth?.authJson },
          DockerManagementService.LONG_DOCKER_OPERATION_TIMEOUT_MS
        );
        this.parseResult(result);
        config.image = finalImageRef;
        await this.registryService?.rememberImageRegistry?.(nodeId, finalImageRef, auth?.registryId);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new AppError(502, 'DISPATCH_ERROR', `Failed to pull ${imageRef}`);
  }

  private hasRegistryHost(imageRef: string) {
    const firstSegment = imageRef.split('/')[0] ?? '';
    return firstSegment === 'localhost' || firstSegment.includes('.') || firstSegment.includes(':');
  }

  private imageRefWithTag(imageRef: string | undefined, tag: string) {
    const trimmedTag = tag.trim();
    if (!imageRef || !trimmedTag) return undefined;
    const digestIndex = imageRef.indexOf('@');
    const withoutDigest = digestIndex >= 0 ? imageRef.slice(0, digestIndex) : imageRef;
    const lastColon = withoutDigest.lastIndexOf(':');
    const lastSlash = withoutDigest.lastIndexOf('/');
    const imageName = lastColon >= 0 && lastSlash < lastColon ? withoutDigest.slice(0, lastColon) : withoutDigest;
    return `${imageName}:${trimmedTag}`;
  }

  async updateContainerEnv(
    nodeId: string,
    containerId: string,
    env: Record<string, string> | undefined,
    removeEnv: string[] | undefined,
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    await this.assertNotManagedDeploymentInternal(nodeId, containerId);
    const name = await this.resolveContainerName(nodeId, containerId);
    const expectedState = await this.resolveExpectedRecreateState(nodeId, containerId);
    const updateStopTimeout = await this.resolveContainerStopTimeout(nodeId, containerId, undefined);
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
        Math.max(60000, this.lifecycleWatchTimeoutMs(updateStopTimeout, 60))
      );
      data = this.parseResult(result);
      if (this.environmentService) {
        await this.environmentService.replace(nodeId, name, env || {});
      }
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
    this.watchRecreateByName(
      nodeId,
      name,
      containerId,
      task?.id,
      'Container env updated',
      expectedState,
      this.lifecycleWatchTimeoutMs(updateStopTimeout, 60)
    );
    await this.auditService.log({
      action: 'docker.container.env.update',
      userId,
      resourceType: 'docker-container',
      resourceId: containerId,
      details: { nodeId },
    });

    return data;
  }

  private normalizeEnvRecord(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key.trim().length > 0)
        .map(([key, entryValue]) => [key, String(entryValue ?? '')])
    );
  }

  private envListToMap(entries: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const entry of entries) {
      const idx = entry.indexOf('=');
      if (idx === -1) {
        env[entry] = '';
      } else {
        env[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }
    return env;
  }

  private envMapToList(env: Record<string, string>): string[] {
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }

  // ─── Image operations ──────────────────────────────────────────────

  async listImages(nodeId: string) {
    await this.validateDockerNode(nodeId);
    return listDockerImages(this.imageOperationContext(), nodeId);
  }

  async pullImage(nodeId: string, imageRef: string, registryAuth?: string, userId?: string, registryId?: string) {
    await this.validateDockerNode(nodeId);
    return pullDockerImage(this.imageOperationContext(), nodeId, imageRef, registryAuth, userId, registryId);
  }

  async removeImage(nodeId: string, imageId: string, force: boolean, userId: string) {
    await this.validateDockerNode(nodeId);
    await removeDockerImage(this.imageOperationContext(), nodeId, imageId, force, userId);
  }

  async pruneImages(nodeId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    return pruneDockerImages(this.imageOperationContext(), nodeId, userId);
  }

  // ─── Volume operations ─────────────────────────────────────────────

  async listVolumes(nodeId: string) {
    await this.validateDockerNode(nodeId);
    return listDockerVolumes(this.volumeNetworkOperationContext(), nodeId);
  }

  async createVolume(
    nodeId: string,
    config: { name: string; driver: string; labels?: Record<string, string> },
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    return createDockerVolume(this.volumeNetworkOperationContext(), nodeId, config, userId);
  }

  async removeVolume(nodeId: string, name: string, force: boolean, userId: string) {
    await this.validateDockerNode(nodeId);
    await removeDockerVolume(this.volumeNetworkOperationContext(), nodeId, name, force, userId);
  }

  // ─── Network operations ────────────────────────────────────────────

  async listNetworks(nodeId: string) {
    await this.validateDockerNode(nodeId);
    return listDockerNetworks(this.volumeNetworkOperationContext(), nodeId);
  }

  async createNetwork(
    nodeId: string,
    config: { name: string; driver: string; subnet?: string; gateway?: string },
    userId: string
  ) {
    await this.validateDockerNode(nodeId);
    return createDockerNetwork(this.volumeNetworkOperationContext(), nodeId, config, userId);
  }

  async removeNetwork(nodeId: string, networkId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await removeDockerNetwork(this.volumeNetworkOperationContext(), nodeId, networkId, userId);
  }

  async connectContainerToNetwork(nodeId: string, networkId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await connectDockerContainerToNetwork(this.volumeNetworkOperationContext(), nodeId, networkId, containerId, userId);
  }

  async disconnectContainerFromNetwork(nodeId: string, networkId: string, containerId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await disconnectDockerContainerFromNetwork(
      this.volumeNetworkOperationContext(),
      nodeId,
      networkId,
      containerId,
      userId
    );
  }

  // ─── Container stats ───────────────────────────────────────────────

  async getContainerStats(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    return getDockerContainerStats(this.readOperationContext(), nodeId, containerId);
  }

  async getContainerTop(nodeId: string, containerId: string) {
    await this.validateDockerNode(nodeId);
    return getDockerContainerTop(this.readOperationContext(), nodeId, containerId);
  }

  // ─── File browser ──────────────────────────────────────────────────

  async listDirectory(nodeId: string, containerId: string, path: string) {
    await this.validateDockerNode(nodeId);
    return listDockerDirectory(this.readOperationContext(), nodeId, containerId, path);
  }

  async readFile(nodeId: string, containerId: string, path: string) {
    await this.validateDockerNode(nodeId);
    return readDockerFile(this.readOperationContext(), nodeId, containerId, path);
  }

  async writeFile(nodeId: string, containerId: string, path: string, content: string, userId: string) {
    await this.validateDockerNode(nodeId);
    await writeDockerFile(this.readOperationContext(), nodeId, containerId, path, content, userId);
  }
}
