import { eq } from 'drizzle-orm';
import type { WSContext } from 'hono/ws';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { resolveWebSocketCredential, type WebSocketCredential } from '@/modules/auth/websocket-auth.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import type { User } from '@/types.js';
import { logRelay, type RelayedLogEntry } from './log-relay.service.js';
import { requestNginxHostLogHistory, subscribeNginxHostLogs } from './nginx-log-subscriptions.js';

const logger = createChildLogger('ProxyLogStream');
const HISTORY_BATCH_SIZE = 200;

interface ProxyLogStreamWSState {
  user: User | null;
  authenticated: boolean;
  streaming: boolean;
  keepaliveInterval: ReturnType<typeof setInterval> | null;
  cleanupSubscription: (() => void) | null;
  loadingMore: boolean;
  pendingWhileLoading: RelayedLogEntry[];
  loadedOffset: number;
  hasMore: boolean;
}

const wsStates = new WeakMap<WSContext, ProxyLogStreamWSState>();

async function authorizeLogAccess(credential: WebSocketCredential | null, hostId: string): Promise<User | null> {
  const result = await resolveWebSocketCredential(credential, `proxy:view:${hostId}`);
  return result?.user ?? null;
}

function send(ws: WSContext, msg: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Connection may already be closed.
  }
}

function logEntryKey(entry: RelayedLogEntry): string {
  return [
    entry.logType,
    entry.timestamp,
    entry.remoteAddr,
    entry.method,
    entry.path,
    entry.status,
    entry.bodyBytesSent,
    entry.raw,
    entry.level,
  ].join('\u0000');
}

async function resolveHostNode(hostId: string): Promise<string | null> {
  const db = container.resolve(TOKENS.DrizzleClient) as DrizzleClient;
  const [host] = await db
    .select({ nodeId: proxyHosts.nodeId })
    .from(proxyHosts)
    .where(eq(proxyHosts.id, hostId))
    .limit(1);
  return host?.nodeId ?? null;
}

export function createProxyLogStreamWSHandlers(hostId: string, tail: number, credential: WebSocketCredential | null) {
  const registry = container.resolve(NodeRegistryService);

  return {
    onOpen(_event: Event, ws: WSContext) {
      const state: ProxyLogStreamWSState = {
        user: null,
        authenticated: false,
        streaming: false,
        keepaliveInterval: null,
        cleanupSubscription: null,
        loadingMore: false,
        pendingWhileLoading: [],
        loadedOffset: 0,
        hasMore: true,
      };
      wsStates.set(ws, state);

      state.keepaliveInterval = setInterval(() => {
        void revalidateLogAccess(ws, state, credential, hostId, true);
      }, 30_000);

      authenticateAndStartStream(ws, state, credential, hostId, tail, registry).catch((err) => {
        logger.error('Proxy log stream start failed', {
          hostId,
          error: err instanceof Error ? err.message : String(err),
        });
        send(ws, { type: 'error', message: 'Failed to start log stream' });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    },

    async onMessage(event: MessageEvent, ws: WSContext) {
      const state = wsStates.get(ws);
      if (!state) return;

      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      try {
        const msg = JSON.parse(raw);
        if (msg?.type === 'ping') {
          send(ws, { type: 'pong' });
        }
        if (msg?.type === 'load_more') {
          if (!state.authenticated || state.loadingMore || !state.hasMore) return;
          if (!(await revalidateLogAccess(ws, state, credential, hostId))) return;
          state.loadingMore = true;
          handleLoadMore(ws, state, hostId, registry).catch((err) => {
            state.loadingMore = false;
            logger.error('Proxy log load_more failed', {
              hostId,
              error: err instanceof Error ? err.message : String(err),
            });
            send(ws, { type: 'error', message: 'Failed to load more logs' });
          });
        }
      } catch {
        // ignore invalid JSON
      }
    },

    onClose(_event: unknown, ws: WSContext) {
      cleanup(ws);
      logger.info('Proxy log stream WS closed', { hostId });
    },

    onError(_error: Event, ws: WSContext) {
      cleanup(ws);
      logger.error('Proxy log stream WS error', { hostId });
    },
  };

  function cleanup(ws: WSContext) {
    const state = wsStates.get(ws);
    if (!state) return;
    if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
    state.cleanupSubscription?.();
    wsStates.delete(ws);
  }
}

async function authenticateAndStartStream(
  ws: WSContext,
  state: ProxyLogStreamWSState,
  credential: WebSocketCredential | null,
  hostId: string,
  tail: number,
  registry: NodeRegistryService
): Promise<void> {
  const user = await authorizeLogAccess(credential, hostId);
  if (!user) {
    send(ws, { type: 'auth_error', message: 'Access revoked or token expired' });
    ws.close(1008, 'Authentication failed');
    return;
  }

  state.user = user;
  state.authenticated = true;

  const nodeId = await resolveHostNode(hostId);
  if (!nodeId) {
    send(ws, { type: 'error', message: 'Proxy host has no nginx node assigned' });
    ws.close(1011, 'Node not connected');
    return;
  }

  const onLog = (entry: RelayedLogEntry) => {
    if (entry.hostId !== hostId) return;
    if (state.loadingMore) {
      state.pendingWhileLoading.push(entry);
      return;
    }
    if (state.streaming) {
      state.loadedOffset += 1;
      send(ws, { type: 'new', entries: [entry] });
    }
  };

  logRelay.on('log', onLog);
  const subscription = subscribeNginxHostLogs(registry, nodeId, hostId, 0);
  if (!subscription.ok) {
    logRelay.off('log', onLog);
    send(ws, { type: 'error', message: subscription.message });
    ws.close(1011, 'Stream start failed');
    return;
  }
  state.cleanupSubscription = () => {
    logRelay.off('log', onLog);
    subscription.cleanup();
  };

  state.loadingMore = true;
  state.pendingWhileLoading = [];
  const initialResult = await requestNginxHostLogHistory(registry, nodeId, hostId, tail + 1);
  if (!initialResult.ok) {
    state.loadingMore = false;
    state.pendingWhileLoading = [];
    send(ws, { type: 'error', message: initialResult.message });
    ws.close(1011, 'Initial fetch failed');
    return;
  }

  const initialEntries = initialResult.entries.slice(-tail);
  state.loadedOffset = initialEntries.length;
  state.hasMore = initialResult.entries.length > tail;
  const snapshotKeys = new Set(initialResult.entries.map(logEntryKey));
  const liveEntries = state.pendingWhileLoading.filter((entry) => !snapshotKeys.has(logEntryKey(entry)));
  state.pendingWhileLoading = [];
  state.loadingMore = false;
  send(ws, { type: 'initial', entries: initialEntries, hasMore: state.hasMore });

  state.streaming = true;
  send(ws, { type: 'connected', streaming: true });
  if (liveEntries.length > 0) {
    state.loadedOffset += liveEntries.length;
    send(ws, { type: 'new', entries: liveEntries });
  }
}

async function handleLoadMore(
  ws: WSContext,
  state: ProxyLogStreamWSState,
  hostId: string,
  registry: NodeRegistryService
) {
  try {
    const nodeId = await resolveHostNode(hostId);
    if (!nodeId) {
      send(ws, { type: 'history', entries: [], hasMore: false });
      state.hasMore = false;
      return;
    }

    state.pendingWhileLoading = [];
    const requestedTail = state.loadedOffset + HISTORY_BATCH_SIZE + 1;
    const result = await requestNginxHostLogHistory(registry, nodeId, hostId, requestedTail);
    if (!result.ok) {
      send(ws, { type: 'error', message: result.message });
      return;
    }

    const end = Math.max(0, result.entries.length - state.loadedOffset);
    const start = Math.max(0, end - HISTORY_BATCH_SIZE);
    const entries = result.entries.slice(start, end);
    state.loadedOffset += entries.length;
    state.hasMore = result.entries.length > state.loadedOffset;
    send(ws, { type: 'history', entries, hasMore: state.hasMore });

    const snapshotKeys = new Set(result.entries.map(logEntryKey));
    const liveEntries = state.pendingWhileLoading.filter((entry) => !snapshotKeys.has(logEntryKey(entry)));
    if (liveEntries.length > 0) {
      state.loadedOffset += liveEntries.length;
      send(ws, { type: 'new', entries: liveEntries });
    }
  } finally {
    state.pendingWhileLoading = [];
    state.loadingMore = false;
  }
}

async function revalidateLogAccess(
  ws: WSContext,
  state: ProxyLogStreamWSState,
  credential: WebSocketCredential | null,
  hostId: string,
  emitPong = false
): Promise<boolean> {
  const user = await authorizeLogAccess(credential, hostId);
  if (!user) {
    state.authenticated = false;
    state.cleanupSubscription?.();
    state.cleanupSubscription = null;
    send(ws, { type: 'auth_error', message: 'Access revoked or token expired' });
    try {
      ws.close(1008, 'Authentication failed');
    } catch {
      /* ignore */
    }
    return false;
  }

  state.user = user;
  if (emitPong) send(ws, { type: 'pong' });
  return true;
}
