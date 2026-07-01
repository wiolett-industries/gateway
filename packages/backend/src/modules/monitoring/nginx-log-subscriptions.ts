import type { LogStreamControl } from '@/grpc/generated/types.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import {
  logRelay,
  NGINX_LOG_SUBSCRIBE_ACK_EVENT,
  type NginxLogSubscribeAck,
  type RelayedLogEntry,
} from './log-relay.service.js';

type WritableLogStream = {
  write: (control: LogStreamControl) => boolean | undefined;
};

type ActiveSubscription = {
  count: number;
  nodeId: string;
  hostId: string;
  logStream: WritableLogStream;
};

const activeSubscriptions = new Map<string, ActiveSubscription>();

function subscriptionKey(nodeId: string, hostId: string) {
  return `${nodeId}:${hostId}`;
}

function getWritableLogStream(
  registry: NodeRegistryService,
  nodeId: string
): { ok: true; logStream: WritableLogStream } | { ok: false; message: string } {
  const node = registry.getNode(nodeId);
  if (!node) return { ok: false, message: 'Nginx node is offline' };
  if (node.type !== 'nginx') return { ok: false, message: 'Node is not an nginx daemon' };

  const logStream = node.logStream as WritableLogStream | null;
  if (!logStream || typeof logStream.write !== 'function') {
    return { ok: false, message: 'Nginx log stream is not connected' };
  }

  return { ok: true, logStream };
}

function writeControl(
  registry: NodeRegistryService,
  nodeId: string,
  control: LogStreamControl
): { ok: true; logStream: WritableLogStream } | { ok: false; message: string } {
  const stream = getWritableLogStream(registry, nodeId);
  if (!stream.ok) return stream;

  try {
    stream.logStream.write(control);
    return stream;
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
    const current = getWritableLogStream(registry, nodeId);
    if (!current.ok) return current;
    if (current.logStream !== existing.logStream) {
      const subscribed = writeControl(registry, nodeId, {
        subscribe: { hostId, tailLines },
      });
      if (!subscribed.ok) return subscribed;
      existing.logStream = subscribed.logStream;
    }
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

  activeSubscriptions.set(key, { count: 1, nodeId, hostId, logStream: subscribed.logStream });

  return {
    ok: true,
    cleanup: () => releaseNginxHostLogs(registry, nodeId, hostId),
  };
}

export function requestNginxHostLogHistory(
  registry: NodeRegistryService,
  nodeId: string,
  hostId: string,
  tailLines: number,
  timeoutMs = 2_000
): Promise<{ ok: true; entries: RelayedLogEntry[] } | { ok: false; message: string }> {
  const requestedTail = Math.max(1, Math.floor(tailLines));

  return new Promise((resolve) => {
    const entries: RelayedLogEntry[] = [];
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      logRelay.off('log', onLog);
      logRelay.off(NGINX_LOG_SUBSCRIBE_ACK_EVENT, onAck);
    };

    const settle = (result: { ok: true; entries: RelayedLogEntry[] } | { ok: false; message: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onLog = (entry: RelayedLogEntry) => {
      if (entry.nodeId === nodeId && entry.hostId === hostId) entries.push(entry);
    };

    const onAck = (ack: NginxLogSubscribeAck) => {
      if (ack.nodeId !== nodeId || ack.hostId !== hostId) return;
      settle({ ok: true, entries });
    };

    const timer = setTimeout(() => {
      if (entries.length > 0) {
        settle({ ok: true, entries });
      } else {
        settle({ ok: false, message: 'Timed out while loading nginx log history' });
      }
    }, timeoutMs);

    logRelay.on('log', onLog);
    logRelay.on(NGINX_LOG_SUBSCRIBE_ACK_EVENT, onAck);

    const written = writeControl(registry, nodeId, {
      subscribe: { hostId, tailLines: -requestedTail },
    });
    if (!written.ok) settle(written);
  });
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
