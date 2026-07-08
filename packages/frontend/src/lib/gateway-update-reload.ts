export const GATEWAY_UPDATE_RELOAD_STORAGE_KEY = "gateway-update-reload";

const GATEWAY_UPDATE_RELOAD_CHANNEL = "gateway-update-reload";

export interface GatewayUpdateReloadMessage {
  id: string;
  at: number;
  version: string | null;
  reason: string;
}

export function normalizeGatewayUpdateVersion(version: string | null | undefined): string {
  return (version ?? "").trim().replace(/^v/i, "");
}

export function isGatewayUpdateTargetVersion(
  currentVersion: string | null | undefined,
  targetVersion: string
): boolean {
  return (
    normalizeGatewayUpdateVersion(currentVersion) === normalizeGatewayUpdateVersion(targetVersion)
  );
}

export function buildGatewayReloadUrl(currentHref: string, nonce: number | string): string {
  const url = new URL(currentHref);
  url.searchParams.set("_v", String(nonce));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function stripGatewayReloadParam(currentHref: string): string | null {
  const url = new URL(currentHref);
  if (!url.searchParams.has("_v")) return null;
  url.searchParams.delete("_v");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function reloadGatewayClient(nonce: number = Date.now()) {
  window.location.href = buildGatewayReloadUrl(window.location.href, nonce);
}

export function publishGatewayReload(
  version: string | null,
  reason: string
): GatewayUpdateReloadMessage {
  const message: GatewayUpdateReloadMessage = {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    at: Date.now(),
    version,
    reason,
  };

  try {
    window.localStorage.setItem(GATEWAY_UPDATE_RELOAD_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Storage can be unavailable in private contexts; BroadcastChannel still covers normal tabs.
  }

  try {
    const channel = new BroadcastChannel(GATEWAY_UPDATE_RELOAD_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Older browsers still get the localStorage event path.
  }

  return message;
}

export function subscribeGatewayReload(handler: (message: GatewayUpdateReloadMessage) => void) {
  const seen = new Set<string>();

  const emit = (message: GatewayUpdateReloadMessage) => {
    if (!message.id || seen.has(message.id)) return;
    seen.add(message.id);
    handler(message);
  };

  const parse = (raw: unknown): GatewayUpdateReloadMessage | null => {
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!value || typeof value !== "object") return null;
      const message = value as Partial<GatewayUpdateReloadMessage>;
      if (typeof message.id !== "string" || typeof message.at !== "number") return null;
      return {
        id: message.id,
        at: message.at,
        version: typeof message.version === "string" ? message.version : null,
        reason: typeof message.reason === "string" ? message.reason : "gateway-update",
      };
    } catch {
      return null;
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== GATEWAY_UPDATE_RELOAD_STORAGE_KEY || event.newValue == null) return;
    const message = parse(event.newValue);
    if (message) emit(message);
  };

  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(GATEWAY_UPDATE_RELOAD_CHANNEL);
    channel.onmessage = (event) => {
      const message = parse(event.data);
      if (message) emit(message);
    };
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    if (channel) {
      channel.onmessage = null;
      channel.close();
    }
  };
}
