import type { WSContext } from 'hono/ws';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope } from '@/lib/permissions.js';
import { resolveLiveSessionUser, resolveLiveUser } from '@/modules/auth/live-session-user.js';
import { EventBusService } from '@/services/event-bus.service.js';
import type { User } from '@/types.js';

const logger = createChildLogger('Events-WebSocket');

interface ConnState {
  user: User | null;
  scopes: string[];
  authenticated: boolean;
  /** channel → unsubscribe fn from EventBus */
  subs: Map<string, () => void>;
  keepalive: ReturnType<typeof setInterval> | null;
  /** unsubscribe from this user's permissions.changed.<userId> */
  permsUnsub: (() => void) | null;
  /** Messages received before authentication completes — drained on auth. */
  pendingMessages: ClientMsg[];
}

interface ClientMsg {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channels?: string[];
}

type ServerMsg =
  | { type: 'event'; channel: string; payload: unknown }
  | { type: 'subscribed'; channels: string[]; rejected: string[] }
  | { type: 'permissions'; scopes: string[] }
  | { type: 'pong' }
  | { type: 'error'; message: string };

const states = new WeakMap<WSContext, ConnState>();
const DATABASE_CHANNEL_SCOPE_BASES = [
  'databases:list',
  'databases:view',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
] as const;

function send(ws: WSContext, msg: ServerMsg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

/**
 * Determine the scope required to subscribe to a channel.
 * Channels with no scope mapping are subscribable by any authenticated user.
 */
function requiredScopeFor(channel: string): string | null {
  if (channel === 'domain.changed') return 'proxy:list';
  if (channel === 'pki.template.changed') return 'pki:templates:list';
  if (channel === 'nginx.template.changed') return 'proxy:list';
  if (channel === 'docker.registry.changed') return 'docker:registries:list';
  if (channel.startsWith('docker.container')) return 'docker:containers:list';
  if (channel.startsWith('docker.image')) return 'docker:images:list';
  if (channel.startsWith('docker.volume')) return 'docker:volumes:list';
  if (channel.startsWith('docker.network')) return 'docker:networks:list';
  if (channel.startsWith('docker.registry')) return 'docker:registries:list';
  if (channel.startsWith('docker.task')) return 'docker:containers:list';
  if (channel.startsWith('docker.webhook')) return 'docker:containers:webhooks';
  if (channel.startsWith('docker.')) return 'docker:containers:list';
  if (channel.startsWith('database.')) return 'databases:list';
  if (channel.startsWith('proxy.host')) return 'proxy:list';
  if (channel.startsWith('ssl.cert')) return 'ssl:cert:list';
  if (channel === 'cert.changed') return 'pki:cert:list';
  if (channel === 'ca.changed') return 'pki:ca:list:root';
  if (channel === 'access-list.changed') return 'acl:list';
  if (channel === 'node.changed') return 'nodes:list';
  if (channel === 'user.changed') return 'admin:users';
  if (channel === 'group.changed') return 'admin:groups';
  if (channel === 'notification.alert-rule.changed') return 'notifications:view';
  if (channel === 'notification.webhook.changed') return 'notifications:view';
  if (channel.startsWith('alert.')) return 'notifications:view';
  // permissions.changed.<userId> is filtered separately (own user only)
  return null;
}

function hasChannelAccess(scopes: string[], channel: string): boolean {
  const required = requiredScopeFor(channel);
  if (!required) return true;

  if (channel.startsWith('docker.container') || channel.startsWith('docker.task')) {
    return scopes.some((scope) => scope === 'docker:containers:list' || scope.startsWith('docker:containers:list:'));
  }
  if (channel.startsWith('docker.image')) {
    return scopes.some((scope) => scope === 'docker:images:list' || scope.startsWith('docker:images:list:'));
  }
  if (channel.startsWith('docker.volume')) {
    return scopes.some((scope) => scope === 'docker:volumes:list' || scope.startsWith('docker:volumes:list:'));
  }
  if (channel.startsWith('docker.network')) {
    return scopes.some((scope) => scope === 'docker:networks:list' || scope.startsWith('docker:networks:list:'));
  }
  if (channel.startsWith('database.')) {
    return scopes.some((scope) =>
      DATABASE_CHANNEL_SCOPE_BASES.some((base) => scope === base || scope.startsWith(`${base}:`))
    );
  }

  return hasScope(scopes, required);
}

function canReceiveChannelPayload(scopes: string[], channel: string, payload: unknown): boolean {
  if (channel.startsWith('docker.container') || channel.startsWith('docker.task')) {
    const nodeId = (payload as { nodeId?: string } | undefined)?.nodeId;
    return (
      hasScope(scopes, 'docker:containers:list') || !!(nodeId && hasScope(scopes, `docker:containers:list:${nodeId}`))
    );
  }
  if (channel.startsWith('docker.image')) {
    const nodeId = (payload as { nodeId?: string } | undefined)?.nodeId;
    return hasScope(scopes, 'docker:images:list') || !!(nodeId && hasScope(scopes, `docker:images:list:${nodeId}`));
  }
  if (channel.startsWith('docker.volume')) {
    const nodeId = (payload as { nodeId?: string } | undefined)?.nodeId;
    return hasScope(scopes, 'docker:volumes:list') || !!(nodeId && hasScope(scopes, `docker:volumes:list:${nodeId}`));
  }
  if (channel.startsWith('docker.network')) {
    const nodeId = (payload as { nodeId?: string } | undefined)?.nodeId;
    return hasScope(scopes, 'docker:networks:list') || !!(nodeId && hasScope(scopes, `docker:networks:list:${nodeId}`));
  }
  if (channel.startsWith('database.')) {
    const databaseId = (payload as { id?: string } | undefined)?.id;
    return (
      DATABASE_CHANNEL_SCOPE_BASES.some((base) => hasScope(scopes, base)) ||
      !!(databaseId &&
        DATABASE_CHANNEL_SCOPE_BASES.some((base) => hasScope(scopes, `${base}:${databaseId}`)))
    );
  }
  return true;
}

async function authenticate(token: string): Promise<{ user: User; scopes: string[] } | null> {
  const result = await resolveLiveSessionUser(token);
  return result ? { user: result.user, scopes: result.effectiveScopes } : null;
}

function clearAll(state: ConnState) {
  for (const unsub of state.subs.values()) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  state.subs.clear();
  if (state.permsUnsub) {
    try {
      state.permsUnsub();
    } catch {
      /* ignore */
    }
    state.permsUnsub = null;
  }
  if (state.keepalive) {
    clearInterval(state.keepalive);
    state.keepalive = null;
  }
}

function subscribePerUser(ws: WSContext, state: ConnState) {
  if (!state.user) return;
  const eventBus = container.resolve(EventBusService);
  const channel = `permissions.changed.${state.user.id}`;
  // Side-effect listener: refresh server-side scopes and drop subscriptions
  // the user has lost access to. The actual delivery to the client goes
  // through the client's explicit subscribe path so we don't double-emit.
  state.permsUnsub = eventBus.subscribe(channel, async (_payload) => {
    try {
      const db = container.resolve<DrizzleClient>(TOKENS.DrizzleClient);
      const fresh = await resolveLiveUser(db, state.user!.id);
      if (fresh) {
        state.user = fresh;
        state.scopes = fresh.scopes ?? [];
      }
    } catch {
      /* ignore */
    }
    for (const ch of [...state.subs.keys()]) {
      const required = requiredScopeFor(ch);
      if (ch.startsWith('database.')) {
        if (!hasChannelAccess(state.scopes, ch)) {
          const unsub = state.subs.get(ch);
          unsub?.();
          state.subs.delete(ch);
        }
        continue;
      }
      if (required && !hasScope(state.scopes, required)) {
        const unsub = state.subs.get(ch);
        unsub?.();
        state.subs.delete(ch);
      }
    }
    send(ws, { type: 'permissions', scopes: state.scopes });
  });
}

export function createEventsWSHandlers() {
  return {
    onOpen(_event: Event, ws: WSContext) {
      const state: ConnState = {
        user: null,
        scopes: [],
        authenticated: false,
        subs: new Map(),
        keepalive: null,
        permsUnsub: null,
        pendingMessages: [],
      };
      states.set(ws, state);
      state.keepalive = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          if (state.keepalive) clearInterval(state.keepalive);
        }
      }, 30_000);
    },

    async onMessage(event: MessageEvent, ws: WSContext) {
      const state = states.get(ws);
      if (!state) return;

      let msg: ClientMsg;
      try {
        const raw = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
          send(ws, { type: 'error', message: 'invalid message' });
          return;
        }
        msg = raw as ClientMsg;
      } catch {
        send(ws, { type: 'error', message: 'invalid json' });
        return;
      }

      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      // Queue messages until authentication completes (auth is async).
      if (!state.authenticated) {
        state.pendingMessages.push(msg);
        return;
      }

      processMessage(ws, state, msg);
    },

    onClose(_event: Event, ws: WSContext) {
      const state = states.get(ws);
      if (state) {
        clearAll(state);
      }
    },

    onError(_event: Event, ws: WSContext) {
      const state = states.get(ws);
      if (state) {
        clearAll(state);
      }
    },
  };
}

function processMessage(ws: WSContext, state: ConnState, msg: ClientMsg) {
  const eventBus = container.resolve(EventBusService);

  if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const ch of msg.channels) {
      if (typeof ch !== 'string' || !ch) continue;
      if (state.subs.has(ch)) {
        accepted.push(ch);
        continue;
      }
      if (!hasChannelAccess(state.scopes, ch)) {
        rejected.push(ch);
        continue;
      }
      // permissions.changed.<userId>: only the user's own is allowed
      if (ch.startsWith('permissions.changed.')) {
        const targetUserId = ch.slice('permissions.changed.'.length);
        if (targetUserId !== state.user?.id) {
          rejected.push(ch);
          continue;
        }
      }
      const unsub = eventBus.subscribe(ch, (payload) => {
        if (!canReceiveChannelPayload(state.scopes, ch, payload)) return;
        send(ws, { type: 'event', channel: ch, payload });
      });
      state.subs.set(ch, unsub);
      accepted.push(ch);
    }
    send(ws, { type: 'subscribed', channels: accepted, rejected });
    return;
  }

  if (msg.type === 'unsubscribe' && Array.isArray(msg.channels)) {
    for (const ch of msg.channels) {
      const unsub = state.subs.get(ch);
      if (unsub) {
        unsub();
        state.subs.delete(ch);
      }
    }
  }
}

/**
 * Authenticate after onOpen — same pattern as the AI WS endpoint.
 */
export async function authenticateEventsConnection(ws: WSContext, token: string): Promise<void> {
  const state = states.get(ws);
  if (!state) return;
  const authResult = await authenticate(token);
  if (!authResult) {
    send(ws, { type: 'error', message: 'unauthenticated' });
    try {
      ws.close(4001, 'unauthenticated');
    } catch {
      /* ignore */
    }
    return;
  }
  state.user = authResult.user;
  state.scopes = authResult.scopes;
  state.authenticated = true;
  subscribePerUser(ws, state);
  send(ws, { type: 'permissions', scopes: state.scopes });
  logger.debug('client authenticated', { userId: state.user.id });
  // Drain anything the client sent before auth completed
  const pending = state.pendingMessages.splice(0);
  for (const msg of pending) {
    processMessage(ws, state, msg);
  }
}
