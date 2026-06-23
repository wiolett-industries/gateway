import type { LogStreamControl } from '@/grpc/generated/types.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';

type WritableLogStream = {
  write: (control: LogStreamControl) => boolean | undefined;
};

type ActiveSubscription = {
  count: number;
  nodeId: string;
  hostId: string;
};

const activeSubscriptions = new Map<string, ActiveSubscription>();

function subscriptionKey(nodeId: string, hostId: string) {
  return `${nodeId}:${hostId}`;
}

function writeControl(
  registry: NodeRegistryService,
  nodeId: string,
  control: LogStreamControl
): { ok: true } | { ok: false; message: string } {
  const node = registry.getNode(nodeId);
  if (!node) return { ok: false, message: 'Nginx node is offline' };
  if (node.type !== 'nginx') return { ok: false, message: 'Node is not an nginx daemon' };

  const logStream = node.logStream as WritableLogStream | null;
  if (!logStream || typeof logStream.write !== 'function') {
    return { ok: false, message: 'Nginx log stream is not connected' };
  }

  try {
    logStream.write(control);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to subscribe to nginx logs',
    };
  }
}

export function subscribeNginxHostLogs(
  registry: NodeRegistryService,
  nodeId: string,
  hostId: string,
  tailLines = 200
): { ok: true; cleanup: () => void } | { ok: false; message: string } {
  const key = subscriptionKey(nodeId, hostId);
  const existing = activeSubscriptions.get(key);

  if (existing) {
    existing.count += 1;
    return {
      ok: true,
      cleanup: () => releaseNginxHostLogs(registry, nodeId, hostId),
    };
  }

  const subscribed = writeControl(registry, nodeId, {
    subscribe: { hostId, tailLines },
  });
  if (!subscribed.ok) return subscribed;

  activeSubscriptions.set(key, { count: 1, nodeId, hostId });

  return {
    ok: true,
    cleanup: () => releaseNginxHostLogs(registry, nodeId, hostId),
  };
}

function releaseNginxHostLogs(registry: NodeRegistryService, nodeId: string, hostId: string) {
  const key = subscriptionKey(nodeId, hostId);
  const existing = activeSubscriptions.get(key);
  if (!existing) return;

  existing.count -= 1;
  if (existing.count > 0) return;

  activeSubscriptions.delete(key);
  writeControl(registry, existing.nodeId, {
    unsubscribe: { hostId: existing.hostId },
  });
}

export function resetNginxLogSubscriptionsForTest() {
  activeSubscriptions.clear();
}
