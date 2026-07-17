import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBusService } from '@/services/event-bus.service.js';
import { DockerSnapshotService, sanitizeContainerInspect } from './docker-snapshot.service.js';

class MemoryCache {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, string>>();

  async get<T>(key: string): Promise<T | null> {
    const value = this.strings.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }
  async set<T>(key: string, value: T) {
    this.strings.set(key, JSON.stringify(value));
  }
  async sadd(key: string, ...values: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    values.forEach((value) => {
      set.add(value);
    });
    this.sets.set(key, set);
    return values.length;
  }
  async srem(key: string, ...values: string[]) {
    values.forEach((value) => {
      this.sets.get(key)?.delete(value);
    });
    return values.length;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  getClient() {
    return {
      hget: async (key: string, field: string) => this.hashes.get(key)?.get(field) ?? null,
      hset: async (key: string, field: string, value: string) => {
        const hash = this.hashes.get(key) ?? new Map<string, string>();
        hash.set(field, value);
        this.hashes.set(key, hash);
        return 1;
      },
      del: async (...keys: string[]) => {
        keys.forEach((key) => {
          this.strings.delete(key);
          this.hashes.delete(key);
        });
        return keys.length;
      },
    };
  }
}

function createService(connected = true) {
  const cache = new MemoryCache();
  const registry = { getNode: vi.fn(() => (connected ? { nodeId: 'node-1' } : undefined)) };
  const service = new DockerSnapshotService({} as never, cache as never, registry as never, new EventBusService());
  return { service, cache, registry };
}

describe('DockerSnapshotService', () => {
  it('preserves last-known data and revision when a refresh fails', async () => {
    const { service } = createService();
    const success = await service.replaceList('node-1', 'containers', [{ id: 'c1', state: 'running' }]);
    expect(service.availability('node-1', success)).toBe('available');

    await service.markListError('node-1', 'containers', new Error('timeout'));
    const failed = await service.getList('node-1', 'containers');

    expect(failed.data).toEqual([{ id: 'c1', state: 'running' }]);
    expect(failed.revision).toBe(1);
    expect(failed.lastError).toBe('timeout');
    expect(service.availability('node-1', failed)).toBe('unavailable');
  });

  it('stays available while refreshing a previously successful snapshot', async () => {
    const { service } = createService();
    await service.replaceList('node-1', 'images', [{ id: 'i1' }]);
    await service.markListRefreshing('node-1', 'images');
    const refreshing = await service.getList('node-1', 'images');
    expect(refreshing.refreshStatus).toBe('refreshing');
    expect(service.availability('node-1', refreshing)).toBe('available');
  });

  it('marks a preserved snapshot unavailable when the node disconnects', async () => {
    const { service, registry } = createService();
    const snapshot = await service.replaceList('node-1', 'volumes', [{ name: 'data' }]);
    registry.getNode.mockReturnValue(undefined);
    expect(service.availability('node-1', snapshot)).toBe('unavailable');
    expect(snapshot.data).toEqual([{ name: 'data' }]);
  });

  it('removes environment values and credential-shaped fields from container inspect snapshots', () => {
    expect(
      sanitizeContainerInspect({
        Id: 'c1',
        Config: { Env: ['API_KEY=value'], Labels: { app: 'demo' }, Password: 'hidden' },
        HostConfig: { RegistryAuth: 'hidden', Nested: { access_token: 'hidden', safe: true } },
      })
    ).toEqual({
      Id: 'c1',
      Config: { Labels: { app: 'demo' } },
      HostConfig: { Nested: { safe: true } },
    });
  });
});
