import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import { resetNginxLogSubscriptionsForTest, subscribeNginxHostLogs } from './nginx-log-subscriptions.js';

function createRegistry(node: unknown): NodeRegistryService {
  return {
    getNode: vi.fn(() => node),
  } as unknown as NodeRegistryService;
}

describe('subscribeNginxHostLogs', () => {
  beforeEach(() => {
    resetNginxLogSubscriptionsForTest();
  });

  it('subscribes and unsubscribes nginx log stream', () => {
    const write = vi.fn();
    const registry = createRegistry({ type: 'nginx', logStream: { write } });

    const subscription = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);

    expect(subscription.ok).toBe(true);
    expect(write).toHaveBeenCalledWith({ subscribe: { hostId: 'host-1', tailLines: 50 } });

    if (subscription.ok) subscription.cleanup();

    expect(write).toHaveBeenLastCalledWith({ unsubscribe: { hostId: 'host-1' } });
  });

  it('shares a daemon subscription across multiple SSE clients', () => {
    const write = vi.fn();
    const registry = createRegistry({ type: 'nginx', logStream: { write } });

    const first = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);
    const second = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);

    if (first.ok) first.cleanup();
    expect(write).toHaveBeenCalledTimes(1);

    if (second.ok) second.cleanup();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({ unsubscribe: { hostId: 'host-1' } });
  });

  it('resubscribes when the daemon log stream reconnects', () => {
    const firstWrite = vi.fn();
    const secondWrite = vi.fn();
    const node = { type: 'nginx', logStream: { write: firstWrite } };
    const registry = createRegistry(node);

    const first = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);
    node.logStream = { write: secondWrite };
    const second = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(firstWrite).toHaveBeenCalledWith({ subscribe: { hostId: 'host-1', tailLines: 50 } });
    expect(secondWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).toHaveBeenCalledWith({ subscribe: { hostId: 'host-1', tailLines: 50 } });

    if (first.ok) first.cleanup();
    if (second.ok) second.cleanup();
    expect(secondWrite).toHaveBeenLastCalledWith({ unsubscribe: { hostId: 'host-1' } });
  });

  it('returns an error when nginx log stream is unavailable', () => {
    const registry = createRegistry({ type: 'nginx', logStream: null });

    const subscription = subscribeNginxHostLogs(registry, 'node-1', 'host-1', 50);

    expect(subscription).toEqual({ ok: false, message: 'Nginx log stream is not connected' });
  });
});
