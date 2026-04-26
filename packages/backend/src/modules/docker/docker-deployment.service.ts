import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import {
  dockerDeploymentReleases,
  dockerDeploymentRoutes,
  dockerDeployments,
  dockerDeploymentSlots,
  dockerWebhooks,
  nodes,
  type DockerDeploymentDesiredConfig,
  type DockerDeploymentHealthConfig,
  type DockerDeploymentSlot,
} from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { DockerRegistryService } from './docker-registry.service.js';
import type { DockerSecretService } from './docker-secret.service.js';
import type { DockerTaskService } from './docker-task.service.js';
import type {
  DockerDeploymentCreateInput,
  DockerDeploymentDeployInput,
  DockerDeploymentSwitchInput,
  DockerDeploymentUpdateInput,
} from './docker-deployment.schemas.js';

export const DOCKER_DEPLOYMENT_MANAGED_LABEL = 'wiolett.gateway.deployment.managed';
export const DOCKER_DEPLOYMENT_ID_LABEL = 'wiolett.gateway.deployment.id';
export const DOCKER_DEPLOYMENT_ROLE_LABEL = 'wiolett.gateway.deployment.role';
export const DOCKER_DEPLOYMENT_SLOT_LABEL = 'wiolett.gateway.deployment.slot';

type DeploymentRow = typeof dockerDeployments.$inferSelect;
type DeploymentRouteRow = typeof dockerDeploymentRoutes.$inferSelect;
type DeploymentSlotRow = typeof dockerDeploymentSlots.$inferSelect;
type DeploymentReleaseRow = typeof dockerDeploymentReleases.$inferSelect;
type DeploymentTransition =
  | 'creating'
  | 'deploying'
  | 'switching'
  | 'rolling_back'
  | 'starting'
  | 'stopping'
  | 'restarting'
  | 'killing'
  | 'removing';

export interface DockerDeploymentDetail extends DeploymentRow {
  routes: DeploymentRouteRow[];
  slots: DeploymentSlotRow[];
  releases: DeploymentReleaseRow[];
  webhook?: typeof dockerWebhooks.$inferSelect | null;
  _transition?: DeploymentTransition;
}

function inactiveSlot(slot: DockerDeploymentSlot): DockerDeploymentSlot {
  return slot === 'blue' ? 'green' : 'blue';
}

function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 12);
}

function normalizeRoutes(routes: DockerDeploymentCreateInput['routes']) {
  const primaryCount = routes.filter((route) => route.isPrimary).length;
  if (primaryCount !== 1) throw new AppError(400, 'INVALID_ROUTES', 'Exactly one route must be primary');
  const hostPorts = new Set<number>();
  for (const route of routes) {
    if (hostPorts.has(route.hostPort)) {
      throw new AppError(400, 'INVALID_ROUTES', `Host port ${route.hostPort} is duplicated`);
    }
    hostPorts.add(route.hostPort);
  }
  return routes;
}

function deploymentRoutesEqual(
  current: Array<Pick<DeploymentRouteRow, 'hostPort' | 'containerPort' | 'isPrimary'>>,
  next: Array<Pick<DeploymentRouteRow, 'hostPort' | 'containerPort' | 'isPrimary'>>
) {
  if (current.length !== next.length) return false;
  const serialize = (routes: Array<Pick<DeploymentRouteRow, 'hostPort' | 'containerPort' | 'isPrimary'>>) =>
    routes
      .map((route) => `${route.hostPort}:${route.containerPort}:${route.isPrimary ? '1' : '0'}`)
      .sort()
      .join('|');
  return serialize(current) === serialize(next);
}

function normalizeHealth(health: DockerDeploymentHealthConfig): DockerDeploymentHealthConfig {
  if (health.statusMin > health.statusMax) {
    throw new AppError(400, 'INVALID_HEALTH', 'Minimum healthy status cannot be greater than maximum status');
  }
  return health;
}

function isBusyDeploymentStatus(status: string) {
  return (
    status === 'creating' ||
    status === 'deploying' ||
    status === 'switching' ||
    status === 'deleting' ||
    status === 'starting' ||
    status === 'stopping' ||
    status === 'restarting' ||
    status === 'killing' ||
    status === 'removing' ||
    status === 'rolling_back'
  );
}

function imageWithTag(image: string, tag?: string) {
  if (!tag) return image;
  const atDigest = image.indexOf('@');
  const digestSuffix = atDigest >= 0 ? image.slice(atDigest) : '';
  const ref = atDigest >= 0 ? image.slice(0, atDigest) : image;
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  const repo = colon > slash ? ref.slice(0, colon) : ref;
  return `${repo}:${tag}${digestSuffix}`;
}

export class DockerDeploymentService {
  private eventBus?: EventBusService;
  private deploymentTransitions = new Map<string, DeploymentTransition>();

  constructor(
    private db: DrizzleClient,
    private audit: AuditService,
    private dispatch: NodeDispatchService,
    private registry: DockerRegistryService,
    private tasks: DockerTaskService,
    private nodeRegistry: NodeRegistryService,
    private secrets?: DockerSecretService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  private emit(action: string, deploymentId: string, nodeId: string, extra?: Record<string, unknown>) {
    this.eventBus?.publish('docker.deployment.changed', { action, deploymentId, nodeId, ...(extra || {}) });
    this.eventBus?.publish('docker.container.changed', { action: 'deployment', deploymentId, nodeId });
  }

  private transitionKey(nodeId: string, deploymentId: string) {
    return `${nodeId}:${deploymentId}`;
  }

  private getTransition(nodeId: string, deploymentId: string): DeploymentTransition | undefined {
    return this.deploymentTransitions.get(this.transitionKey(nodeId, deploymentId));
  }

  private requireDeploymentIdle(deployment: Pick<DockerDeploymentDetail, 'id' | 'nodeId' | 'status'>) {
    const current = this.getTransition(deployment.nodeId, deployment.id);
    if (current) {
      throw new AppError(409, 'DEPLOYMENT_BUSY', `Deployment is currently ${current}`);
    }
    if (isBusyDeploymentStatus(deployment.status)) {
      throw new AppError(409, 'DEPLOYMENT_BUSY', `Deployment is currently ${deployment.status}`);
    }
  }

  private setTransition(deployment: Pick<DockerDeploymentDetail, 'id' | 'nodeId' | 'name'>, transition: DeploymentTransition) {
    this.deploymentTransitions.set(this.transitionKey(deployment.nodeId, deployment.id), transition);
    this.eventBus?.publish('docker.deployment.changed', {
      action: 'transitioning',
      deploymentId: deployment.id,
      nodeId: deployment.nodeId,
      name: deployment.name,
      transition,
    });
    this.eventBus?.publish('docker.container.changed', {
      action: 'transitioning',
      deploymentId: deployment.id,
      nodeId: deployment.nodeId,
      name: deployment.name,
      id: deployment.id,
      transition,
    });
  }

  private clearTransition(deployment: Pick<DockerDeploymentDetail, 'id' | 'nodeId' | 'name'>) {
    this.deploymentTransitions.delete(this.transitionKey(deployment.nodeId, deployment.id));
  }

  private parseResult(result: { success: boolean; error?: string; detail?: string }) {
    if (!result.success) throw new AppError(502, 'DISPATCH_ERROR', result.error || 'Command failed on daemon');
    try {
      return result.detail ? JSON.parse(result.detail) : null;
    } catch {
      return result.detail;
    }
  }

  private async validateDockerNode(nodeId: string, requireCapability = true) {
    const [node] = await this.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found');
    if (node.type !== 'docker') throw new AppError(400, 'NOT_DOCKER', 'Node is not a Docker node');
    if (!this.nodeRegistry.getNode(nodeId)) throw new AppError(502, 'NODE_OFFLINE', 'Node is offline');

    const capabilities = (node.capabilities ?? {}) as Record<string, unknown>;
    const advertised = Array.isArray(capabilities.capabilities) ? capabilities.capabilities : [];
    const hasCapability =
      capabilities.dockerDeploymentsV1 === true ||
      capabilities.docker_deployments_v1 === true ||
      advertised.includes('docker_deployments_v1');
    if (requireCapability && !hasCapability) {
      throw new AppError(409, 'UNSUPPORTED_DAEMON', 'Docker node does not support blue/green deployments');
    }
    return node;
  }

  private async assertNameAvailable(nodeId: string, name: string, excludeDeploymentId?: string) {
    const existingDeploymentQuery = this.db
      .select({ id: dockerDeployments.id })
      .from(dockerDeployments)
      .where(
        excludeDeploymentId
          ? and(
              eq(dockerDeployments.nodeId, nodeId),
              eq(dockerDeployments.name, name),
              ne(dockerDeployments.id, excludeDeploymentId)
            )
          : and(eq(dockerDeployments.nodeId, nodeId), eq(dockerDeployments.name, name))
      )
      .limit(1);
    const [existingDeployment] = await existingDeploymentQuery;
    if (existingDeployment) throw new AppError(409, 'NAME_IN_USE', `A deployment named "${name}" already exists`);

    const result = await this.dispatch.sendDockerContainerCommand(nodeId, 'list');
    const containers = this.parseResult(result);
    if (Array.isArray(containers)) {
      const collision = containers.some((item: any) => {
        const labels = item.labels ?? item.Labels ?? {};
        if (labels[DOCKER_DEPLOYMENT_MANAGED_LABEL] === 'true') return false;
        const itemName = ((item.name ?? item.Name ?? '') as string).replace(/^\//, '');
        return itemName === name;
      });
      if (collision) throw new AppError(409, 'NAME_IN_USE', `A container named "${name}" already exists`);
    }
  }

  private async loadDeployment(nodeId: string, deploymentId: string): Promise<DockerDeploymentDetail> {
    const [deployment] = await this.db
      .select()
      .from(dockerDeployments)
      .where(and(eq(dockerDeployments.nodeId, nodeId), eq(dockerDeployments.id, deploymentId)))
      .limit(1);
    if (!deployment) throw new AppError(404, 'NOT_FOUND', 'Deployment not found');

    const [routes, slots, releases, webhookRows] = await Promise.all([
      this.db.select().from(dockerDeploymentRoutes).where(eq(dockerDeploymentRoutes.deploymentId, deploymentId)),
      this.db.select().from(dockerDeploymentSlots).where(eq(dockerDeploymentSlots.deploymentId, deploymentId)),
      this.db
        .select()
        .from(dockerDeploymentReleases)
        .where(eq(dockerDeploymentReleases.deploymentId, deploymentId))
        .orderBy(desc(dockerDeploymentReleases.createdAt))
        .limit(20),
      this.db.select().from(dockerWebhooks).where(eq(dockerWebhooks.deploymentId, deploymentId)).limit(1),
    ]);

    const detail = { ...deployment, routes, slots, releases, webhook: webhookRows[0] ?? null };
    const transition = this.getTransition(nodeId, deploymentId);
    return transition ? { ...detail, _transition: transition } : detail;
  }

  private secretContainerName(deploymentId: string) {
    return `deployment:${deploymentId}`;
  }

  private async desiredConfigWithSecrets(
    nodeId: string,
    deploymentId: string,
    desiredConfig: DockerDeploymentDesiredConfig
  ) {
    const secrets = await this.secrets?.getDecryptedMap(nodeId, this.secretContainerName(deploymentId));
    if (!secrets || Object.keys(secrets).length === 0) return desiredConfig;
    return { ...desiredConfig, env: { ...(desiredConfig.env ?? {}), ...secrets } };
  }

  async list(nodeId: string) {
    await this.validateDockerNode(nodeId, false);
    const deployments = await this.db
      .select()
      .from(dockerDeployments)
      .where(eq(dockerDeployments.nodeId, nodeId))
      .orderBy(dockerDeployments.name);
    return Promise.all(deployments.map((deployment) => this.loadDeployment(nodeId, deployment.id)));
  }

  async syntheticRows(nodeId: string) {
    const deployments = await this.list(nodeId);
    return deployments.map((deployment) => this.toSyntheticRow(deployment));
  }

  private toSyntheticRow(deployment: DockerDeploymentDetail) {
    const active = deployment.slots.find((slot) => slot.slot === deployment.activeSlot);
    const primary = deployment.routes.find((route) => route.isPrimary) ?? deployment.routes[0];
    return {
      id: deployment.id,
      name: deployment.name,
      image: active?.image ?? deployment.desiredConfig.image,
      state: deployment.status === 'ready' ? active?.status || 'running' : deployment.status,
      status: `active ${deployment.activeSlot}`,
      created: Math.floor(new Date(deployment.createdAt).getTime() / 1000),
      ports: deployment.routes.map((route) => ({
        privatePort: route.containerPort,
        publicPort: route.hostPort,
        type: 'tcp',
      })),
      labels: {},
      kind: 'deployment',
      deploymentId: deployment.id,
      activeSlot: deployment.activeSlot,
      primaryRoute: primary ? { hostPort: primary.hostPort, containerPort: primary.containerPort } : null,
      activeSlotContainerId: active?.containerId ?? null,
      folderId: null,
      folderIsSystem: false,
      folderSortOrder: 0,
      ...(deployment._transition ? { _transition: deployment._transition } : {}),
    };
  }

  async get(nodeId: string, deploymentId: string) {
    await this.validateDockerNode(nodeId, false);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async create(nodeId: string, input: DockerDeploymentCreateInput, userId: string) {
    await this.validateDockerNode(nodeId);
    normalizeRoutes(input.routes);
    const health = normalizeHealth(input.health);
    await this.assertNameAvailable(nodeId, input.name);

    const id = randomUUID();
    const suffix = shortId(id);
    const routerName = `gwdep-${suffix}-router`;
    const networkName = `gwdep-${suffix}-net`;
    const blueName = `gwdep-${suffix}-blue`;
    const greenName = `gwdep-${suffix}-green`;
    const desiredConfig: DockerDeploymentDesiredConfig = {
      image: input.image,
      env: input.env,
      mounts: input.mounts,
      command: input.command,
      entrypoint: input.entrypoint,
      workingDir: input.workingDir,
      user: input.user,
      labels: input.labels,
      restartPolicy: input.restartPolicy,
      runtime: input.runtime,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(dockerDeployments).values({
        id,
        nodeId,
        name: input.name,
        desiredConfig,
        activeSlot: 'blue',
        status: 'creating',
        routerName,
        routerImage: input.routerImage,
        networkName,
        healthConfig: health,
        drainSeconds: input.drainSeconds,
        createdById: userId,
        updatedById: userId,
      });
      await tx.insert(dockerDeploymentRoutes).values(
        input.routes.map((route) => ({
          deploymentId: id,
          hostPort: route.hostPort,
          containerPort: route.containerPort,
          isPrimary: route.isPrimary,
        }))
      );
      await tx.insert(dockerDeploymentSlots).values([
        {
          deploymentId: id,
          slot: 'blue',
          containerName: blueName,
          image: input.image,
          desiredConfig,
          status: 'creating',
        },
        {
          deploymentId: id,
          slot: 'green',
          containerName: greenName,
          image: input.image,
          desiredConfig,
          status: 'creating',
        },
      ]);
    });

    const registryAuth = await this.registry.resolveAuthForImagePull(nodeId, input.image);
    const daemonDesiredConfig = await this.desiredConfigWithSecrets(nodeId, id, desiredConfig);
    const payload = {
      deploymentId: id,
      name: input.name,
      activeSlot: 'blue',
      routerName,
      routerImage: input.routerImage,
      networkName,
      slots: { blue: blueName, green: greenName },
      routes: input.routes,
      health,
      desiredConfig: daemonDesiredConfig,
      registryAuthJson: registryAuth?.authJson,
      labels: this.internalLabels(id, 'app', 'blue'),
    };

    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'create', {
        deploymentId: id,
        slot: 'blue',
        configJson: JSON.stringify(payload),
      });
      const data = this.parseResult(result) ?? {};
      await this.db.transaction(async (tx) => {
        await tx
          .update(dockerDeployments)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(dockerDeployments.id, id));
        await tx
          .update(dockerDeploymentSlots)
          .set({
            containerId: data.blueContainerId ?? data.containerId ?? null,
            image: input.image,
            desiredConfig,
            status: 'running',
            health: 'healthy',
            updatedAt: new Date(),
          })
          .where(and(eq(dockerDeploymentSlots.deploymentId, id), eq(dockerDeploymentSlots.slot, 'blue')));
        await tx
          .update(dockerDeploymentSlots)
          .set({
            containerId: data.greenContainerId ?? null,
            image: input.image,
            desiredConfig,
            status: 'created',
            health: 'unknown',
            updatedAt: new Date(),
          })
          .where(and(eq(dockerDeploymentSlots.deploymentId, id), eq(dockerDeploymentSlots.slot, 'green')));
        await tx.insert(dockerDeploymentReleases).values({
          deploymentId: id,
          toSlot: 'blue',
          image: input.image,
          triggerSource: 'create',
          status: 'succeeded',
          createdById: userId,
          completedAt: new Date(),
        });
      });
      await this.audit.log({
        action: 'docker.deployment.create',
        userId,
        resourceType: 'docker-deployment',
        resourceId: id,
        details: { nodeId, name: input.name },
      });
      this.emit('created', id, nodeId);
      return this.loadDeployment(nodeId, id);
    } catch (err) {
      await this.db
        .update(dockerDeployments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(dockerDeployments.id, id))
        .catch(() => {});
      throw err;
    }
  }

  async update(nodeId: string, deploymentId: string, input: DockerDeploymentUpdateInput, userId: string) {
    await this.validateDockerNode(nodeId);
    const current = await this.loadDeployment(nodeId, deploymentId);
    if (input.name && input.name !== current.name) await this.assertNameAvailable(nodeId, input.name, deploymentId);
    const routes = input.routes ? normalizeRoutes(input.routes) : undefined;
    const health = input.health ? normalizeHealth(input.health) : current.healthConfig;
    const desiredConfig = input.desiredConfig
      ? { ...current.desiredConfig, ...input.desiredConfig }
      : current.desiredConfig;

    if (routes && !deploymentRoutesEqual(current.routes, routes)) {
      try {
        const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'update_router', {
          deploymentId,
          configJson: JSON.stringify({
            deployment: { ...current, routes, healthConfig: health, desiredConfig },
            routes,
          }),
        });
        this.parseResult(result);
      } catch (err) {
        await this.db.transaction(async (tx) => {
          await tx
            .update(dockerDeployments)
            .set({ status: 'stopped', updatedAt: new Date(), updatedById: userId })
            .where(eq(dockerDeployments.id, deploymentId));
          await tx
            .update(dockerDeploymentSlots)
            .set({ status: 'stopped', health: 'unknown', drainingUntil: null, updatedAt: new Date() })
            .where(eq(dockerDeploymentSlots.deploymentId, deploymentId));
        });
        this.emit('failed', deploymentId, nodeId, {
          action: 'update_router',
          error: err instanceof Error ? err.message : err,
        });
        throw err;
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(dockerDeployments)
        .set({
          name: input.name ?? current.name,
          desiredConfig,
          healthConfig: health,
          drainSeconds: input.drainSeconds ?? current.drainSeconds,
          updatedById: userId,
          updatedAt: new Date(),
        })
        .where(eq(dockerDeployments.id, deploymentId));
      if (routes) {
        await tx.delete(dockerDeploymentRoutes).where(eq(dockerDeploymentRoutes.deploymentId, deploymentId));
        await tx.insert(dockerDeploymentRoutes).values(
          routes.map((route) => ({
            deploymentId,
            hostPort: route.hostPort,
            containerPort: route.containerPort,
            isPrimary: route.isPrimary,
          }))
        );
      }
    });
    this.emit('updated', deploymentId, nodeId);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async deploy(
    nodeId: string,
    deploymentId: string,
    input: DockerDeploymentDeployInput,
    userId: string | null,
    source = 'manual'
  ) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'deploying');
    const toSlot = inactiveSlot(deployment.activeSlot);
    const targetImage = input.image ?? imageWithTag(deployment.desiredConfig.image, input.tag);
    const desiredConfig = {
      ...deployment.desiredConfig,
      image: targetImage,
      env: input.env ?? deployment.desiredConfig.env,
    };
    let task: Awaited<ReturnType<DockerTaskService['create']>> | null = null;
    let release: DeploymentReleaseRow | null = null;

    try {
      task = await this.tasks.create({
        nodeId,
        containerId: deploymentId,
        containerName: deployment.name,
        type: 'deployment_deploy',
      });
      await this.tasks.update(task.id, { status: 'running', progress: `Deploying ${targetImage} to ${toSlot}` });
      [release] = await this.db
        .insert(dockerDeploymentReleases)
        .values({
          deploymentId,
          fromSlot: deployment.activeSlot,
          toSlot,
          image: targetImage,
          triggerSource: source,
          taskId: task.id,
          status: 'running',
          createdById: userId,
        })
        .returning();

      await this.db
        .update(dockerDeployments)
        .set({ status: 'deploying', desiredConfig, updatedAt: new Date(), updatedById: userId })
        .where(eq(dockerDeployments.id, deploymentId));
      this.emit('deploying', deploymentId, nodeId, { toSlot });

      await this.switchToSlot(nodeId, deploymentId, { slot: toSlot, force: false }, userId, {
        releaseId: release.id,
        image: targetImage,
        source,
      });
      await this.tasks.update(task.id, {
        status: 'succeeded',
        progress: `Deployed ${targetImage}`,
        completedAt: new Date(),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Deployment failed';
      await Promise.all([
        task ? this.tasks.update(task.id, { status: 'failed', error, completedAt: new Date() }).catch(() => {}) : null,
        release
          ? this.db
              .update(dockerDeploymentReleases)
              .set({ status: 'failed', error, completedAt: new Date() })
              .where(eq(dockerDeploymentReleases.id, release.id))
              .catch(() => {})
          : null,
        this.db
          .update(dockerDeployments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(dockerDeployments.id, deploymentId)),
      ]);
      this.emit('failed', deploymentId, nodeId, { error });
      throw err;
    } finally {
      this.clearTransition(deployment);
    }
    return this.loadDeployment(nodeId, deploymentId);
  }

  async switchToSlot(
    nodeId: string,
    deploymentId: string,
    input: DockerDeploymentSwitchInput,
    userId: string | null,
    releaseContext?: { releaseId?: string; image?: string; source?: string; desiredConfig?: DockerDeploymentDesiredConfig }
  ) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    const managesTransition = !releaseContext;
    const target = deployment.slots.find((slot) => slot.slot === input.slot);
    if (!target || !target.containerName) throw new AppError(404, 'SLOT_NOT_FOUND', 'Slot does not exist');
    if (managesTransition) {
      this.requireDeploymentIdle(deployment);
      this.setTransition(deployment, 'switching');
    }
    const previous = deployment.activeSlot;
    const desiredConfig = {
      ...deployment.desiredConfig,
      ...releaseContext?.desiredConfig,
      image: releaseContext?.image ?? deployment.desiredConfig.image,
    };
    const daemonDesiredConfig = await this.desiredConfigWithSecrets(nodeId, deploymentId, desiredConfig);
    const registryAuth = await this.registry.resolveAuthForImagePull(nodeId, daemonDesiredConfig.image);
    let data: any;
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(
        nodeId,
        'switch',
        {
          deploymentId,
          slot: input.slot,
          configJson: JSON.stringify({
            deployment,
            activeSlot: input.slot,
            routes: deployment.routes,
            force: input.force,
            desiredConfig: daemonDesiredConfig,
            registryAuthJson: registryAuth?.authJson,
          }),
        },
        (deployment.healthConfig.deployTimeoutSeconds + 30) * 1000
      );
      data = this.parseResult(result) ?? {};
    } catch (err) {
      this.emit('failed', deploymentId, nodeId, { action: 'switch', error: err instanceof Error ? err.message : err });
      if (managesTransition) this.clearTransition(deployment);
      throw err;
    }

    const drainingUntil =
      deployment.drainSeconds > 0 ? new Date(Date.now() + deployment.drainSeconds * 1000) : new Date();
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(dockerDeployments)
          .set({
            activeSlot: input.slot,
            status: 'ready',
            desiredConfig: releaseContext?.desiredConfig ?? deployment.desiredConfig,
            updatedAt: new Date(),
            updatedById: userId,
          })
          .where(eq(dockerDeployments.id, deploymentId));
        await tx
          .update(dockerDeploymentSlots)
          .set({
            containerId: data.containerId ?? target.containerId,
            image: daemonDesiredConfig.image,
            desiredConfig,
            status: 'running',
            health: 'healthy',
            drainingUntil: null,
            updatedAt: new Date(),
          })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, input.slot)));
        await tx
          .update(dockerDeploymentSlots)
          .set({ status: 'draining', drainingUntil, updatedAt: new Date() })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, previous)));
        if (releaseContext?.releaseId) {
          await tx
            .update(dockerDeploymentReleases)
            .set({ status: 'succeeded', completedAt: new Date() })
            .where(eq(dockerDeploymentReleases.id, releaseContext.releaseId));
        } else {
          await tx.insert(dockerDeploymentReleases).values({
            deploymentId,
            fromSlot: previous,
            toSlot: input.slot,
            image: daemonDesiredConfig.image,
            triggerSource: releaseContext?.source ?? 'switch',
            status: 'succeeded',
            createdById: userId,
            completedAt: new Date(),
          });
        }
      });

      this.scheduleDrainCleanup(nodeId, deploymentId, previous, deployment.drainSeconds, drainingUntil);
      await this.audit.log({
        action: 'docker.deployment.switch',
        userId,
        resourceType: 'docker-deployment',
        resourceId: deploymentId,
        details: { nodeId, from: previous, to: input.slot, force: input.force },
      });
      this.emit('switched', deploymentId, nodeId, { activeSlot: input.slot });
      return this.loadDeployment(nodeId, deploymentId);
    } finally {
      if (managesTransition) this.clearTransition(deployment);
    }
  }

  async rollback(nodeId: string, deploymentId: string, force: boolean, userId: string | null) {
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'rolling_back');
    try {
      const rollbackSlot = deployment.slots.find((slot) => slot.slot === inactiveSlot(deployment.activeSlot));
      if (!rollbackSlot?.image) {
        throw new AppError(409, 'ROLLBACK_UNAVAILABLE', 'Rollback slot does not have a previous image');
      }
      const desiredConfig = rollbackSlot.desiredConfig ?? { ...deployment.desiredConfig, image: rollbackSlot.image };
      await this.switchToSlot(nodeId, deploymentId, { slot: inactiveSlot(deployment.activeSlot), force }, userId, {
        image: desiredConfig.image,
        source: 'rollback',
        desiredConfig,
      });
    } finally {
      this.clearTransition(deployment);
    }
    return this.loadDeployment(nodeId, deploymentId);
  }

  async stopSlot(nodeId: string, deploymentId: string, slot: DockerDeploymentSlot, userId: string | null) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    if (slot === deployment.activeSlot) throw new AppError(409, 'ACTIVE_SLOT', 'Cannot stop the active slot');
    const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'stop_slot', {
      deploymentId,
      slot,
      configJson: JSON.stringify({ deployment, slot }),
    });
    this.parseResult(result);
    await this.db
      .update(dockerDeploymentSlots)
      .set({ status: 'stopped', health: 'unknown', drainingUntil: null, updatedAt: new Date() })
      .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, slot)));
    await this.audit.log({
      action: 'docker.deployment.slot.stop',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId, slot },
    });
    this.emit('slot_stopped', deploymentId, nodeId, { slot });
  }

  async start(nodeId: string, deploymentId: string, userId: string | null) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'starting');
    let data: any;
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'start', {
        deploymentId,
        configJson: JSON.stringify({ deployment }),
      });
      data = this.parseResult(result) ?? {};
    } catch (err) {
      this.emit('failed', deploymentId, nodeId, { action: 'start', error: err instanceof Error ? err.message : err });
      throw err;
    } finally {
      this.clearTransition(deployment);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(dockerDeployments)
        .set({ status: 'ready', updatedAt: new Date(), updatedById: userId })
        .where(eq(dockerDeployments.id, deploymentId));
      await tx
        .update(dockerDeploymentSlots)
        .set({
          containerId:
            data.containerId ??
            deployment.slots.find((slot) => slot.slot === deployment.activeSlot)?.containerId ??
            null,
          status: 'running',
          health: 'healthy',
          drainingUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dockerDeploymentSlots.deploymentId, deploymentId),
            eq(dockerDeploymentSlots.slot, deployment.activeSlot)
          )
        );
      for (const slot of deployment.slots.filter((item) => item.slot !== deployment.activeSlot)) {
        await tx
          .update(dockerDeploymentSlots)
          .set({
            status: slot.containerId || slot.image ? 'stopped' : 'empty',
            health: 'unknown',
            drainingUntil: null,
            updatedAt: new Date(),
          })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, slot.slot)));
      }
    });
    await this.audit.log({
      action: 'docker.deployment.start',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
    this.emit('started', deploymentId, nodeId);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async stop(nodeId: string, deploymentId: string, userId: string | null) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'stopping');
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'stop', {
        deploymentId,
        configJson: JSON.stringify({ deployment }),
      });
      this.parseResult(result);
    } catch (err) {
      this.emit('failed', deploymentId, nodeId, { action: 'stop', error: err instanceof Error ? err.message : err });
      throw err;
    } finally {
      this.clearTransition(deployment);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(dockerDeployments)
        .set({ status: 'stopped', updatedAt: new Date(), updatedById: userId })
        .where(eq(dockerDeployments.id, deploymentId));
      await tx
        .update(dockerDeploymentSlots)
        .set({ status: 'stopped', health: 'unknown', updatedAt: new Date() })
        .where(eq(dockerDeploymentSlots.deploymentId, deploymentId));
      for (const slot of deployment.slots) {
        if (slot.containerId || slot.image) continue;
        await tx
          .update(dockerDeploymentSlots)
          .set({ status: 'empty', health: 'unknown', drainingUntil: null, updatedAt: new Date() })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, slot.slot)));
      }
    });
    await this.audit.log({
      action: 'docker.deployment.stop',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
    this.emit('stopped', deploymentId, nodeId);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async restart(nodeId: string, deploymentId: string, userId: string | null) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'restarting');
    let data: any;
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'restart', {
        deploymentId,
        configJson: JSON.stringify({ deployment }),
      });
      data = this.parseResult(result) ?? {};
    } catch (err) {
      this.emit('failed', deploymentId, nodeId, { action: 'restart', error: err instanceof Error ? err.message : err });
      throw err;
    } finally {
      this.clearTransition(deployment);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(dockerDeployments)
        .set({ status: 'ready', updatedAt: new Date(), updatedById: userId })
        .where(eq(dockerDeployments.id, deploymentId));
      await tx
        .update(dockerDeploymentSlots)
        .set({
          containerId:
            data.containerId ??
            deployment.slots.find((slot) => slot.slot === deployment.activeSlot)?.containerId ??
            null,
          status: 'running',
          health: 'healthy',
          drainingUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dockerDeploymentSlots.deploymentId, deploymentId),
            eq(dockerDeploymentSlots.slot, deployment.activeSlot)
          )
        );
      for (const slot of deployment.slots.filter((item) => item.slot !== deployment.activeSlot)) {
        await tx
          .update(dockerDeploymentSlots)
          .set({
            status: slot.containerId || slot.image ? 'stopped' : 'empty',
            health: 'unknown',
            drainingUntil: null,
            updatedAt: new Date(),
          })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, slot.slot)));
      }
    });
    await this.audit.log({
      action: 'docker.deployment.restart',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
    this.emit('restarted', deploymentId, nodeId);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async kill(nodeId: string, deploymentId: string, userId: string | null) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'killing');
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'kill', {
        deploymentId,
        configJson: JSON.stringify({ deployment }),
      });
      this.parseResult(result);
    } catch (err) {
      this.emit('failed', deploymentId, nodeId, { action: 'kill', error: err instanceof Error ? err.message : err });
      throw err;
    } finally {
      this.clearTransition(deployment);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(dockerDeployments)
        .set({ status: 'stopped', updatedAt: new Date(), updatedById: userId })
        .where(eq(dockerDeployments.id, deploymentId));
      await tx
        .update(dockerDeploymentSlots)
        .set({ status: 'stopped', health: 'unknown', updatedAt: new Date() })
        .where(eq(dockerDeploymentSlots.deploymentId, deploymentId));
      for (const slot of deployment.slots) {
        if (slot.containerId || slot.image) continue;
        await tx
          .update(dockerDeploymentSlots)
          .set({ status: 'empty', health: 'unknown', drainingUntil: null, updatedAt: new Date() })
          .where(and(eq(dockerDeploymentSlots.deploymentId, deploymentId), eq(dockerDeploymentSlots.slot, slot.slot)));
      }
    });
    await this.audit.log({
      action: 'docker.deployment.kill',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
    this.emit('killed', deploymentId, nodeId);
    return this.loadDeployment(nodeId, deploymentId);
  }

  async remove(nodeId: string, deploymentId: string, userId: string) {
    await this.validateDockerNode(nodeId);
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    this.requireDeploymentIdle(deployment);
    this.setTransition(deployment, 'removing');
    await this.db
      .update(dockerDeployments)
      .set({ status: 'deleting', updatedAt: new Date() })
      .where(eq(dockerDeployments.id, deploymentId));
    try {
      const result = await this.dispatch.sendDockerDeploymentCommand(nodeId, 'remove', {
        deploymentId,
        configJson: JSON.stringify({ deployment }),
      });
      this.parseResult(result);
      this.clearTransition(deployment);
      await this.db.delete(dockerDeployments).where(eq(dockerDeployments.id, deploymentId));
    } catch (err) {
      this.clearTransition(deployment);
      await this.db
        .update(dockerDeployments)
        .set({ status: deployment.status, updatedAt: new Date() })
        .where(eq(dockerDeployments.id, deploymentId))
        .catch(() => {});
      this.emit('failed', deploymentId, nodeId, { action: 'remove', error: err instanceof Error ? err.message : err });
      throw err;
    }
    await this.audit.log({
      action: 'docker.deployment.delete',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId, name: deployment.name },
    });
    this.emit('deleted', deploymentId, nodeId);
  }

  async getWebhook(nodeId: string, deploymentId: string) {
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    return deployment.webhook ?? null;
  }

  async upsertWebhook(
    nodeId: string,
    deploymentId: string,
    input: { cleanupEnabled?: boolean; retentionCount?: number },
    userId: string
  ) {
    const deployment = await this.loadDeployment(nodeId, deploymentId);
    const existing = deployment.webhook;
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
      return updated;
    }
    const [created] = await this.db
      .insert(dockerWebhooks)
      .values({
        nodeId,
        containerName: deployment.name,
        targetType: 'deployment',
        deploymentId,
        cleanupEnabled: input.cleanupEnabled ?? false,
        retentionCount: input.retentionCount ?? 2,
      })
      .returning();
    await this.audit.log({
      action: 'docker.deployment.webhook.created',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId, name: deployment.name },
    });
    return created;
  }

  async deleteWebhook(nodeId: string, deploymentId: string, userId: string) {
    const webhook = await this.getWebhook(nodeId, deploymentId);
    if (!webhook) throw new AppError(404, 'NOT_FOUND', 'Webhook not found');
    await this.db.delete(dockerWebhooks).where(eq(dockerWebhooks.id, webhook.id));
    await this.audit.log({
      action: 'docker.deployment.webhook.deleted',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
  }

  async regenerateWebhook(nodeId: string, deploymentId: string, userId: string) {
    const webhook = await this.getWebhook(nodeId, deploymentId);
    if (!webhook) throw new AppError(404, 'NOT_FOUND', 'Webhook not found');
    const [updated] = await this.db
      .update(dockerWebhooks)
      .set({ token: randomUUID(), updatedAt: new Date() })
      .where(eq(dockerWebhooks.id, webhook.id))
      .returning();
    await this.audit.log({
      action: 'docker.deployment.webhook.regenerated',
      userId,
      resourceType: 'docker-deployment',
      resourceId: deploymentId,
      details: { nodeId },
    });
    return updated;
  }

  async triggerWebhook(webhookId: string, tag?: string) {
    const [webhook] = await this.db.select().from(dockerWebhooks).where(eq(dockerWebhooks.id, webhookId)).limit(1);
    if (!webhook?.deploymentId) throw new AppError(404, 'NOT_FOUND', 'Deployment webhook not found');
    const deployment = await this.loadDeployment(webhook.nodeId, webhook.deploymentId);
    const result = await this.deploy(webhook.nodeId, webhook.deploymentId, { tag }, null, 'webhook');
    return { deploymentId: deployment.id, message: `Deploying ${deployment.name}`, deployment: result };
  }

  scheduleDrainCleanup(
    nodeId: string,
    deploymentId: string,
    slot: DockerDeploymentSlot,
    delaySeconds: number,
    expectedDrainingUntil: Date
  ) {
    if (delaySeconds <= 0) {
      void this.runDrainCleanup(nodeId, deploymentId, slot, expectedDrainingUntil).catch(() => {});
      return;
    }
    setTimeout(() => {
      void this.runDrainCleanup(nodeId, deploymentId, slot, expectedDrainingUntil).catch(() => {});
    }, delaySeconds * 1000);
  }

  private async runDrainCleanup(
    nodeId: string,
    deploymentId: string,
    slot: DockerDeploymentSlot,
    expectedDrainingUntil: Date
  ) {
    if (this.getTransition(nodeId, deploymentId)) {
      setTimeout(() => {
        void this.runDrainCleanup(nodeId, deploymentId, slot, expectedDrainingUntil).catch(() => {});
      }, 5000);
      return;
    }

    const deployment = await this.loadDeployment(nodeId, deploymentId);
    if (deployment.activeSlot === slot) return;

    const slotRow = deployment.slots.find((item) => item.slot === slot);
    if (!slotRow || slotRow.status !== 'draining' || !slotRow.drainingUntil) return;

    const currentDrainUntil =
      slotRow.drainingUntil instanceof Date
        ? slotRow.drainingUntil.getTime()
        : new Date(slotRow.drainingUntil).getTime();
    if (currentDrainUntil !== expectedDrainingUntil.getTime()) return;

    await this.stopSlot(nodeId, deploymentId, slot, null);
  }

  private internalLabels(deploymentId: string, role: 'router' | 'app', slot?: DockerDeploymentSlot) {
    return {
      [DOCKER_DEPLOYMENT_MANAGED_LABEL]: 'true',
      [DOCKER_DEPLOYMENT_ID_LABEL]: deploymentId,
      [DOCKER_DEPLOYMENT_ROLE_LABEL]: role,
      ...(slot ? { [DOCKER_DEPLOYMENT_SLOT_LABEL]: slot } : {}),
    };
  }
}
