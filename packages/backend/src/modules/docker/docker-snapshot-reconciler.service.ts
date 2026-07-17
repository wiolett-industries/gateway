import { createChildLogger } from '@/lib/logger.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import {
  DOCKER_SNAPSHOT_KINDS,
  type DockerDetailKind,
  type DockerRefreshKind,
  type DockerSnapshotKind,
  type DockerSnapshotService,
} from './docker-snapshot.service.js';

const logger = createChildLogger('DockerSnapshotReconciler');
const DAEMON_TIMEOUT_MS = 10_000;
const MAX_GLOBAL_REFRESHES = 4;
const BACKOFF_MS = [10_000, 30_000, 60_000] as const;

interface RefreshJob {
  nodeId: string;
  kind: DockerRefreshKind;
  key?: string;
}

interface JobState {
  status: 'queued' | 'inflight';
  dirty: boolean;
  job: RefreshJob;
}

interface FailureState {
  failures: number;
  retryAt: number;
}

function jobId(job: RefreshJob) {
  return `${job.nodeId}:${job.kind}:${job.key ?? ''}`;
}

function resultData(result: { success: boolean; detail?: string; error?: string }) {
  if (!result.success) throw new Error(result.error || result.detail || 'Docker daemon command failed');
  if (!result.detail) return null;
  try {
    return JSON.parse(result.detail);
  } catch {
    return result.detail;
  }
}

function listItemKey(kind: DockerDetailKind, item: Record<string, unknown>): string | null {
  if (kind === 'container-detail') {
    const value = item.name ?? item.Name ?? item.id ?? item.Id;
    return typeof value === 'string' ? value.replace(/^\/+/, '') : null;
  }
  const value = item.name ?? item.Name;
  return typeof value === 'string' ? value : null;
}

export class DockerSnapshotReconciler {
  private readonly queue: string[] = [];
  private readonly states = new Map<string, JobState>();
  private readonly failures = new Map<string, FailureState>();
  private readonly activeNodes = new Set<string>();
  private activeCount = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly snapshots: DockerSnapshotService,
    private readonly dispatch: NodeDispatchService,
    private readonly registry: NodeRegistryService,
    private readonly eventBus: EventBusService
  ) {}

  start(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.eventBus.subscribe('node.changed', (payload) => this.onNodeChanged(payload)),
      this.eventBus.subscribe('docker.container.changed', (payload) =>
        this.onResourceChanged('containers', 'container-detail', payload)
      ),
      this.eventBus.subscribe('docker.image.changed', (payload) =>
        this.onResourceChanged('images', undefined, payload)
      ),
      this.eventBus.subscribe('docker.volume.changed', (payload) =>
        this.onResourceChanged('volumes', 'volume-detail', payload)
      ),
      this.eventBus.subscribe('docker.network.changed', (payload) =>
        this.onResourceChanged('networks', undefined, payload)
      )
    );
    for (const nodeId of this.registry.getNodesByType('docker').map((node) => node.nodeId)) {
      this.enqueueNode(nodeId);
    }
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  enqueue(job: RefreshJob): void {
    const id = jobId(job);
    const current = this.states.get(id);
    if (current?.status === 'inflight') {
      current.dirty = true;
      return;
    }
    if (current?.status === 'queued') return;
    this.states.set(id, { status: 'queued', dirty: false, job });
    this.queue.push(id);
    this.drain();
  }

  enqueueNode(nodeId: string): void {
    for (const kind of DOCKER_SNAPSHOT_KINDS) this.enqueue({ nodeId, kind });
  }

  enqueueConnected(kind: DockerSnapshotKind): void {
    for (const node of this.registry.getNodesByType('docker')) this.enqueue({ nodeId: node.nodeId, kind });
  }

  async enqueueDueDetails(): Promise<void> {
    for (const node of this.registry.getNodesByType('docker')) {
      await this.enqueueStaleDetails(node.nodeId, 'container-detail', 'containers');
      await this.enqueueStaleDetails(node.nodeId, 'volume-detail', 'volumes');
    }
  }

  private async enqueueStaleDetails(nodeId: string, detailKind: DockerDetailKind, listKind: DockerSnapshotKind) {
    const list = await this.snapshots.getList<Record<string, unknown>[]>(nodeId, listKind);
    if (!Array.isArray(list.data)) return;
    const details = await this.snapshots.getDetails(nodeId, detailKind);
    const now = Date.now();
    for (const item of list.data) {
      const key = listItemKey(detailKind, item);
      if (!key) continue;
      const detail = details[key];
      const observedAt = detail?.observedAt
        ? Date.parse(detail.observedAt)
        : detail?.lastAttemptAt
          ? Date.parse(detail.lastAttemptAt)
          : 0;
      if (now - observedAt >= 5 * 60_000) this.enqueue({ nodeId, kind: detailKind, key });
    }
  }

  private onNodeChanged(payload: unknown) {
    if (!payload || typeof payload !== 'object') return;
    const event = payload as Record<string, unknown>;
    const nodeId = typeof event.id === 'string' ? event.id : null;
    if (!nodeId) return;
    if (event.action === 'deleted') {
      void this.snapshots
        .purgeNode(nodeId)
        .catch((error) => logger.warn('Failed to purge node snapshots', { nodeId, error }));
    } else if (event.status === 'online' && this.registry.getNode(nodeId)?.type === 'docker') {
      this.enqueueNode(nodeId);
    } else if (event.status === 'offline') {
      void this.snapshots.publishNodeAvailability(nodeId).catch(() => {
        // Non-Docker nodes share node.changed; they have no Docker snapshots to announce.
      });
    }
  }

  private onResourceChanged(kind: DockerSnapshotKind, detailKind: DockerDetailKind | undefined, payload: unknown) {
    if (!payload || typeof payload !== 'object') return;
    const event = payload as Record<string, unknown>;
    const nodeId = typeof event.nodeId === 'string' ? event.nodeId : null;
    if (!nodeId) return;
    this.enqueue({ nodeId, kind });
    if (!detailKind || event.action === 'removed' || event.action === 'deleted') return;
    const key = [event.name, event.id, event.ref].find((value): value is string => typeof value === 'string');
    if (key) this.enqueue({ nodeId, kind: detailKind, key });
  }

  private drain(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    while (this.activeCount < MAX_GLOBAL_REFRESHES) {
      const now = Date.now();
      const index = this.queue.findIndex((id) => {
        const state = this.states.get(id);
        if (!state || state.status !== 'queued' || this.activeNodes.has(state.job.nodeId)) return false;
        return (this.failures.get(id)?.retryAt ?? 0) <= now;
      });
      if (index < 0) break;
      const [id] = this.queue.splice(index, 1);
      if (!id) break;
      const state = this.states.get(id);
      if (!state) continue;
      state.status = 'inflight';
      this.activeCount += 1;
      this.activeNodes.add(state.job.nodeId);
      void this.run(state.job)
        .catch(() => {})
        .finally(() => this.finish(id));
    }
    this.scheduleRetry();
  }

  private scheduleRetry() {
    const retryAt = this.queue
      .map((id) => this.failures.get(id)?.retryAt ?? 0)
      .filter((value) => value > Date.now())
      .sort((a, b) => a - b)[0];
    if (retryAt && !this.retryTimer) {
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = undefined;
          this.drain();
        },
        Math.max(1, retryAt - Date.now())
      );
    }
  }

  private finish(id: string) {
    const state = this.states.get(id);
    if (!state) return;
    this.activeCount -= 1;
    this.activeNodes.delete(state.job.nodeId);
    if (state.dirty || this.failures.has(id)) {
      state.status = 'queued';
      state.dirty = false;
      if (!this.queue.includes(id)) this.queue.push(id);
    } else {
      this.states.delete(id);
    }
    this.drain();
  }

  private async run(job: RefreshJob): Promise<void> {
    const id = jobId(job);
    try {
      if (DOCKER_SNAPSHOT_KINDS.includes(job.kind as DockerSnapshotKind)) {
        await this.refreshList(job.nodeId, job.kind as DockerSnapshotKind);
      } else {
        await this.refreshDetail(job.nodeId, job.kind as DockerDetailKind, job.key!);
      }
      this.failures.delete(id);
    } catch (error) {
      const previous = this.failures.get(id)?.failures ?? 0;
      const failures = previous + 1;
      const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!;
      this.failures.set(id, { failures, retryAt: Date.now() + delay });
      if (DOCKER_SNAPSHOT_KINDS.includes(job.kind as DockerSnapshotKind)) {
        await this.snapshots.markListError(job.nodeId, job.kind as DockerSnapshotKind, error);
      } else if (job.key) {
        await this.snapshots.markDetailError(job.nodeId, job.kind as DockerDetailKind, job.key, error);
      }
      logger.debug('Docker snapshot refresh failed', {
        nodeId: job.nodeId,
        kind: job.kind,
        key: job.key,
        failures,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async refreshList(nodeId: string, kind: DockerSnapshotKind) {
    await this.snapshots.markListRefreshing(nodeId, kind);
    let result: { success: boolean; detail?: string; error?: string };
    switch (kind) {
      case 'containers':
        result = await this.dispatch.sendDockerContainerCommand(nodeId, 'list', {}, DAEMON_TIMEOUT_MS);
        break;
      case 'images':
        result = await this.dispatch.sendDockerImageCommand(nodeId, 'list', {}, DAEMON_TIMEOUT_MS);
        break;
      case 'volumes':
        result = await this.dispatch.sendDockerVolumeCommand(nodeId, 'list', {}, DAEMON_TIMEOUT_MS);
        break;
      case 'networks':
        result = await this.dispatch.sendDockerNetworkCommand(nodeId, 'list', {}, DAEMON_TIMEOUT_MS);
        break;
    }
    const data = resultData(result);
    if (!Array.isArray(data)) throw new Error(`Docker ${kind} list returned an invalid payload`);
    await this.snapshots.replaceList(nodeId, kind, data);
  }

  private async refreshDetail(nodeId: string, kind: DockerDetailKind, key: string) {
    const result =
      kind === 'container-detail'
        ? await this.dispatch.sendDockerContainerCommand(nodeId, 'inspect', { containerId: key }, DAEMON_TIMEOUT_MS)
        : await this.dispatch.sendDockerVolumeCommand(nodeId, 'inspect', { name: key }, DAEMON_TIMEOUT_MS);
    await this.snapshots.replaceDetail(nodeId, kind, key, resultData(result));
  }
}
