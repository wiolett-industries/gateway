import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

type EventHandler = (payload: unknown) => void;

interface ServerMsg {
  type: string;
  channel?: string;
  payload?: unknown;
  scopes?: string[];
  channels?: string[];
  rejected?: string[];
  message?: string;
}

/**
 * Singleton WebSocket client for the realtime `/api/events` channel.
 * - One persistent connection per session, reconnects with exponential backoff.
 * - `subscribe(channel, handler)` returns an unsubscribe function.
 * - Buffers subscribe requests until the socket is OPEN.
 * - On reconnect, re-issues the current subscription set.
 */
class EventStream {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  /** Channels currently subscribed on the wire (subset of handlers.keys() once acked) */
  private wireSubs = new Set<string>();
  private pendingSubs = new Set<string>();
  private backoffMs = 1000;
  private maxBackoffMs = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Refcount of callers who want the connection open. React StrictMode runs
   * effects mount→cleanup→mount which would otherwise spawn duplicate sockets.
   */
  private refCount = 0;
  /** Microtask handle for the deferred initial open */
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private listeners = new Set<(connected: boolean) => void>();

  start() {
    this.refCount++;
    if (this.refCount > 1) return;
    // Defer the actual socket open by one tick so a StrictMode tight
    // mount→cleanup→mount cycle nets to a single connection.
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (this.refCount === 0) return;
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      this.openSocket();
    }, 0);
  }

  stop() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const dying = this.ws;
      this.ws = null;
      try {
        dying.onopen = null;
        dying.onmessage = null;
        dying.onclose = null;
        dying.onerror = null;
        dying.close();
      } catch {
        /* ignore */
      }
    }
    this.wireSubs.clear();
    this.pendingSubs.clear();
    this.setConnected(false);
  }

  private get wantOpen() {
    return this.refCount > 0;
  }

  private openSocket() {
    const sessionId = useAuthStore.getState().sessionId;
    if (!sessionId) {
      // Defer until logged in
      this.scheduleReconnect();
      return;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/events?token=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    // Property-based handlers so stop() can null them out and prevent late
    // events from a closing socket from mutating singleton state after a
    // subsequent start() has already opened a replacement.
    ws.onopen = () => {
      this.backoffMs = 1000;
      this.setConnected(true);
      const desired = new Set([...this.handlers.keys(), ...this.pendingSubs]);
      this.wireSubs.clear();
      this.pendingSubs.clear();
      if (desired.size > 0) {
        this.sendSubscribe([...desired]);
      }
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "event" && msg.channel) {
        // Direct store invalidation for node status changes
        if (msg.channel === "node.changed") {
          api.invalidateCache("req:/api/nodes");
          import("@/stores/nodes")
            .then((m) => m.useNodesStore.getState().invalidate())
            .catch(() => {});
          import("@/stores/pinned-nodes")
            .then((m) => m.usePinnedNodesStore.getState().invalidate())
            .catch(() => {});
        } else if (msg.channel === "domain.changed") {
          api.invalidateCache("req:/api/domains");
          api.invalidateCache("domains:list");
        } else if (msg.channel === "ca.changed") {
          api.invalidateCache("req:/api/cas");
          api.invalidateCache("cas:list:");
          api.invalidateCache("req:/api/monitoring/dashboard");
          api.invalidateCache("dashboard:stats:");
        } else if (msg.channel === "cert.changed") {
          api.invalidateCache("req:/api/certificates");
          api.invalidateCache("certificates:list:");
          api.invalidateCache("req:/api/cas");
          api.invalidateCache("cas:list:");
          api.invalidateCache("req:/api/monitoring/dashboard");
          api.invalidateCache("dashboard:stats:");
        } else if (msg.channel === "ssl.cert.changed") {
          api.invalidateCache("req:/api/ssl-certificates");
          api.invalidateCache("ssl:list:");
          api.invalidateCache("req:/api/monitoring/dashboard");
          api.invalidateCache("dashboard:stats:");
        } else if (msg.channel === "proxy.host.changed") {
          api.invalidateCache("req:/api/proxy-hosts");
          api.invalidateCache("req:/api/proxy-host-folders/grouped");
          api.invalidateCache("proxy:grouped");
          api.invalidateCache("req:/api/domains");
          api.invalidateCache("domains:list");
          api.invalidateCache("req:/api/monitoring/dashboard");
          api.invalidateCache("req:/api/monitoring/health-status");
          api.invalidateCache("dashboard:stats:");
          api.invalidateCache("dashboard:health");
        } else if (msg.channel === "pki.template.changed") {
          api.invalidateCache("req:/api/templates");
          api.invalidateCache("templates:list");
        } else if (msg.channel === "nginx.template.changed") {
          api.invalidateCache("req:/api/nginx-templates");
          api.invalidateCache("nginx-templates:list");
        } else if (msg.channel === "access-list.changed") {
          api.invalidateCache("req:/api/access-lists");
          api.invalidateCache("access-lists:list");
        } else if (msg.channel === "user.changed") {
          api.invalidateCache("req:/api/admin/users");
          api.invalidateCache("admin:users");
        } else if (msg.channel === "group.changed") {
          api.invalidateCache("req:/api/admin/groups");
          api.invalidateCache("req:/api/admin/users");
          api.invalidateCache("admin:users");
        } else if (msg.channel === "docker.registry.changed") {
          api.invalidateCache("req:/api/docker/registries");
        } else if (msg.channel === "docker.template.changed") {
          api.invalidateCache("req:/api/docker/templates");
        } else if (msg.channel === "notification.alert-rule.changed") {
          api.invalidateCache("req:/api/notifications/alert-rules");
        } else if (msg.channel === "notification.webhook.changed") {
          api.invalidateCache("req:/api/notifications/webhooks");
        } else if (msg.channel.startsWith("docker.")) {
          api.invalidateCache("req:/api/docker");
        } else if (msg.channel.startsWith("alert.")) {
          api.invalidateCache("req:/api/notifications/deliveries");
        }

        const set = this.handlers.get(msg.channel);
        if (set) {
          for (const fn of set) {
            try {
              fn(msg.payload);
            } catch {
              /* handler error */
            }
          }
        }
      } else if (msg.type === "subscribed" && Array.isArray(msg.channels)) {
        for (const ch of msg.channels) this.wireSubs.add(ch);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // racing stop()→start() — leave singleton alone
      this.setConnected(false);
      this.ws = null;
      this.wireSubs.clear();
      if (this.wantOpen) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // The close handler will fire next; nothing to do here.
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.openSocket();
    }, delay);
  }

  private sendSubscribe(channels: string[]) {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", channels }));
    } else {
      for (const ch of channels) this.pendingSubs.add(ch);
    }
  }

  private sendUnsubscribe(channels: string[]) {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", channels }));
    }
    for (const ch of channels) {
      this.wireSubs.delete(ch);
      this.pendingSubs.delete(ch);
    }
  }

  subscribe(channel: string, handler: EventHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      this.sendSubscribe([channel]);
    }
    set.add(handler);

    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        this.sendUnsubscribe([channel]);
      }
    };
  }

  isConnected() {
    return this.connected;
  }

  onStatus(fn: (connected: boolean) => void): () => void {
    this.listeners.add(fn);
    fn(this.connected);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch {
        /* ignore */
      }
    }
  }
}

export const eventStream = new EventStream();
