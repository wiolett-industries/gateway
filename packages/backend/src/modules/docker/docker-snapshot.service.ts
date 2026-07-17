import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { CacheService } from '@/services/cache.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';

export const DOCKER_SNAPSHOT_KINDS = ['containers', 'images', 'volumes', 'networks'] as const;
export type DockerSnapshotKind = (typeof DOCKER_SNAPSHOT_KINDS)[number];
export type DockerDetailKind = 'container-detail' | 'volume-detail';
export type DockerRefreshKind = DockerSnapshotKind | DockerDetailKind;
export type DockerAvailability = 'available' | 'unavailable';

export interface DockerSnapshotEnvelope<T = unknown[]> {
  data: T;
  revision: number;
  observedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  refreshStatus: 'never' | 'refreshing' | 'success' | 'error';
}

export interface DockerSnapshotNodeMetadata {
  id: string;
  slug: string;
  hostname: string;
  displayName: string | null;
  appearanceColor: string | null;
  availability: DockerAvailability;
  revision: number;
  observedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

const PREFIX = 'gateway:docker:snapshot:v1';
const NODE_INDEX_KEY = `${PREFIX}:nodes`;
const VIEW_SCOPES: Record<DockerSnapshotKind, string> = {
  containers: 'docker:containers:view',
  images: 'docker:images:view',
  volumes: 'docker:volumes:view',
  networks: 'docker:networks:view',
};

function emptyEnvelope<T>(data: T): DockerSnapshotEnvelope<T> {
  return {
    data,
    revision: 0,
    observedAt: null,
    lastAttemptAt: null,
    lastError: null,
    refreshStatus: 'never',
  };
}

export function sanitizeContainerInspect(value: unknown): unknown {
  const visit = (input: unknown, parentKey = ''): unknown => {
    if (Array.isArray(input)) return input.map((item) => visit(item, parentKey));
    if (!input || typeof input !== 'object') return input;

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (parentKey.toLowerCase() === 'config' && normalized === 'env') continue;
      if (
        normalized === 'registryauth' ||
        normalized === 'registryauthjson' ||
        normalized === 'authconfig' ||
        /(?:password|passwd|secret|credential|privatekey|access[_-]?token|refresh[_-]?token)/i.test(key)
      ) {
        continue;
      }
      result[key] = visit(nested, key);
    }
    return result;
  };
  return visit(value);
}

export class DockerSnapshotService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly cache: CacheService,
    private readonly registry: NodeRegistryService,
    private readonly eventBus: EventBusService
  ) {}

  private listKey(nodeId: string, kind: DockerSnapshotKind) {
    return `${PREFIX}:${nodeId}:list:${kind}`;
  }

  private detailKey(nodeId: string, kind: DockerDetailKind) {
    return `${PREFIX}:${nodeId}:details:${kind}`;
  }

  private async trackNode(nodeId: string) {
    await this.cache.sadd(NODE_INDEX_KEY, nodeId);
  }

  async assertDockerNode(nodeId: string) {
    const [node] = await this.db
      .select({ id: nodes.id, type: nodes.type })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found');
    if (node.type !== 'docker') throw new AppError(400, 'NOT_DOCKER', 'Node is not a Docker node');
  }

  async getList<T = unknown[]>(nodeId: string, kind: DockerSnapshotKind): Promise<DockerSnapshotEnvelope<T>> {
    return (await this.cache.get<DockerSnapshotEnvelope<T>>(this.listKey(nodeId, kind))) ?? emptyEnvelope([] as T);
  }

  async markListRefreshing(nodeId: string, kind: DockerSnapshotKind): Promise<void> {
    const current = await this.getList(nodeId, kind);
    await this.trackNode(nodeId);
    await this.cache.set(this.listKey(nodeId, kind), {
      ...current,
      lastAttemptAt: new Date().toISOString(),
      refreshStatus: 'refreshing',
    });
  }

  async replaceList(nodeId: string, kind: DockerSnapshotKind, data: unknown[]): Promise<DockerSnapshotEnvelope> {
    const current = await this.getList(nodeId, kind);
    const now = new Date().toISOString();
    const next: DockerSnapshotEnvelope = {
      data,
      revision: current.revision + 1,
      observedAt: now,
      lastAttemptAt: now,
      lastError: null,
      refreshStatus: 'success',
    };
    await this.trackNode(nodeId);
    await this.cache.set(this.listKey(nodeId, kind), next);
    this.eventBus.publish('docker.snapshot.changed', { nodeId, kind, revision: next.revision });
    return next;
  }

  async markListError(nodeId: string, kind: DockerSnapshotKind, error: unknown): Promise<void> {
    const current = await this.getList(nodeId, kind);
    await this.trackNode(nodeId);
    await this.cache.set(this.listKey(nodeId, kind), {
      ...current,
      lastAttemptAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      refreshStatus: 'error',
    });
  }

  async getDetail<T = unknown>(nodeId: string, kind: DockerDetailKind, key: string) {
    const value = await this.cache.getClient().hget(this.detailKey(nodeId, kind), key);
    if (!value) return null;
    return JSON.parse(value) as DockerSnapshotEnvelope<T>;
  }

  async getDetails<T = unknown>(nodeId: string, kind: DockerDetailKind) {
    const values = await this.cache.getClient().hgetall(this.detailKey(nodeId, kind));
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, JSON.parse(value) as DockerSnapshotEnvelope<T>])
    );
  }

  async getContainerDetailSnapshot(nodeId: string, key: string): Promise<DockerSnapshotEnvelope<any>> {
    await this.assertDockerNode(nodeId);
    const direct = await this.getDetail<any>(nodeId, 'container-detail', key);
    if (direct) return direct;
    const list = await this.getList<Record<string, unknown>[]>(nodeId, 'containers');
    const match = Array.isArray(list.data)
      ? list.data.find(
          (item) =>
            String(item.id ?? item.Id ?? '') === key || String(item.name ?? item.Name ?? '').replace(/^\/+/, '') === key
        )
      : undefined;
    const name = String(match?.name ?? match?.Name ?? '').replace(/^\/+/, '');
    if (name && name !== key) {
      const byName = await this.getDetail<any>(nodeId, 'container-detail', name);
      if (byName) return byName;
    }
    throw new AppError(404, 'CONTAINER_NOT_FOUND', 'Container snapshot not found');
  }

  async getContainerDetail(nodeId: string, key: string): Promise<any> {
    return (await this.getContainerDetailSnapshot(nodeId, key)).data;
  }

  async replaceDetail(nodeId: string, kind: DockerDetailKind, key: string, data: unknown) {
    const current = await this.getDetail(nodeId, kind, key);
    const now = new Date().toISOString();
    const next: DockerSnapshotEnvelope<unknown> = {
      data: kind === 'container-detail' ? sanitizeContainerInspect(data) : data,
      revision: (current?.revision ?? 0) + 1,
      observedAt: now,
      lastAttemptAt: now,
      lastError: null,
      refreshStatus: 'success',
    };
    await this.trackNode(nodeId);
    await this.cache.getClient().hset(this.detailKey(nodeId, kind), key, JSON.stringify(next));
    this.eventBus.publish('docker.snapshot.changed', { nodeId, kind, key, revision: next.revision });
    return next;
  }

  async markDetailError(nodeId: string, kind: DockerDetailKind, key: string, error: unknown) {
    const current = (await this.getDetail(nodeId, kind, key)) ?? emptyEnvelope(null);
    const next = {
      ...current,
      lastAttemptAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      refreshStatus: 'error' as const,
    };
    await this.trackNode(nodeId);
    await this.cache.getClient().hset(this.detailKey(nodeId, kind), key, JSON.stringify(next));
  }

  availability(nodeId: string, envelope: DockerSnapshotEnvelope<unknown>): DockerAvailability {
    return this.registry.getNode(nodeId) && envelope.observedAt !== null && envelope.lastError === null
      ? 'available'
      : 'unavailable';
  }

  async listVisibleNodes(kind: DockerSnapshotKind, scopes: string[], nodeId?: string) {
    const rows = await this.db
      .select({
        id: nodes.id,
        slug: nodes.slug,
        hostname: nodes.hostname,
        displayName: nodes.displayName,
        appearanceColor: nodes.appearanceColor,
      })
      .from(nodes)
      .where(eq(nodes.type, 'docker'));
    const scope = VIEW_SCOPES[kind];
    return rows.filter(
      (node) => (!nodeId || node.id === nodeId) && TokensService.hasScope(scopes, `${scope}:${node.id}`)
    );
  }

  toNodeMetadata(
    node: { id: string; slug: string; hostname: string; displayName: string | null; appearanceColor: string | null },
    envelope: DockerSnapshotEnvelope
  ): DockerSnapshotNodeMetadata {
    return {
      ...node,
      availability: this.availability(node.id, envelope),
      revision: envelope.revision,
      observedAt: envelope.observedAt,
      lastAttemptAt: envelope.lastAttemptAt,
      lastError: envelope.lastError,
    };
  }

  async publishNodeAvailability(nodeId: string): Promise<void> {
    await this.assertDockerNode(nodeId);
    await Promise.all(
      DOCKER_SNAPSHOT_KINDS.map(async (kind) => {
        const snapshot = await this.getList(nodeId, kind);
        this.eventBus.publish('docker.snapshot.changed', {
          nodeId,
          kind,
          revision: snapshot.revision,
          availability: this.availability(nodeId, snapshot),
        });
      })
    );
  }

  async purgeNode(nodeId: string): Promise<void> {
    const keys = [
      ...DOCKER_SNAPSHOT_KINDS.map((kind) => this.listKey(nodeId, kind)),
      this.detailKey(nodeId, 'container-detail'),
      this.detailKey(nodeId, 'volume-detail'),
    ];
    await this.cache.getClient().del(...keys);
    await this.cache.srem(NODE_INDEX_KEY, nodeId);
  }

  async purgeOrphans(): Promise<void> {
    const tracked = await this.cache.smembers(NODE_INDEX_KEY);
    if (tracked.length === 0) return;
    const existing = new Set(
      (await this.db.select({ id: nodes.id }).from(nodes).where(eq(nodes.type, 'docker'))).map((node) => node.id)
    );
    await Promise.all(tracked.filter((nodeId) => !existing.has(nodeId)).map((nodeId) => this.purgeNode(nodeId)));
  }
}
