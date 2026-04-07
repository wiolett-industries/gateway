import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { VirtualLogList } from "@/components/ui/virtual-log-list";
import { api } from "@/services/api";

const CHANNEL_PREFIX = "docker-logs:";

function hasTimestamp(line: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(line) || /^\d{2}:\d{2}:\d{2}/.test(line);
}

export function DockerLogsPopout() {
  const { nodeId, containerId } = useParams<{ nodeId: string; containerId: string }>();

  const [lines, setLines] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // BroadcastChannel
  useEffect(() => {
    if (!containerId) return;
    const channel = new BroadcastChannel(CHANNEL_PREFIX + containerId);
    channelRef.current = channel;

    channel.postMessage({ type: "popout-open" });

    channel.onmessage = (evt) => {
      if (evt.data?.type === "ping") channel.postMessage({ type: "pong" });
      if (evt.data?.type === "request-close") window.close();
    };

    const heartbeat = setInterval(() => {
      channel.postMessage({ type: "heartbeat" });
    }, 2000);

    const onPageHide = () => {
      channel.postMessage({ type: "popout-close" });
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(heartbeat);
      channel.postMessage({ type: "popout-close" });
      channel.close();
      channelRef.current = null;
    };
  }, [containerId]);

  useEffect(() => {
    if (containerId) {
      document.title = `Logs — ${containerId.slice(0, 12)}`;
    }
  }, [containerId]);

  const processLine = useCallback((line: string): string => {
    const dockerTsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)$/);
    if (dockerTsMatch) {
      const rest = dockerTsMatch[2];
      if (hasTimestamp(rest)) return rest;
      const ts = new Date(dockerTsMatch[1]);
      const time = ts.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${time}  ${rest}`;
    }
    return line;
  }, []);

  const processLogs = useCallback(
    (rawLines: string[]): string[] => rawLines.map(processLine),
    [processLine]
  );

  const connectWs = useCallback(() => {
    if (!nodeId || !containerId) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnecting(true);
    setLines([]);
    setHasMore(true);
    setLoadingMore(false);

    const ws = api.createLogStreamWebSocket(nodeId, containerId, 200);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "initial") {
          setLines(processLogs(msg.lines ?? []));
          setHasMore(msg.hasMore ?? false);
          setIsConnecting(false);
        } else if (msg.type === "history") {
          setLines((prev) => [...processLogs(msg.lines ?? []), ...prev]);
          setHasMore(msg.hasMore ?? false);
          setLoadingMore(false);
        } else if (msg.type === "new") {
          setLines((prev) => {
            const updated = [...prev, ...processLogs(msg.lines ?? [])];
            return updated.length > 10000 ? updated.slice(-10000) : updated;
          });
        }
      } catch { /* */ }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connectWs();
      }, 3000);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setIsConnecting(false);
    };
  }, [nodeId, containerId, processLogs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connect once on mount
  useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => { if (mountedRef.current) connectWs(); }, 50);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, []);

  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  const requestMoreLines = useCallback(() => {
    if (!hasMoreRef.current || loadingMoreRef.current) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    wsRef.current.send(JSON.stringify({ type: "load_more" }));
  }, []);

  return (
    <VirtualLogList
      lines={lines}
      keyFn={(_, i) => i}
      renderLine={(line) => (
        <div className="whitespace-pre-wrap break-all leading-5 px-4 font-mono text-xs text-gray-300">
          {line as string}
        </div>
      )}
      onLoadMore={requestMoreLines}
      hasMore={hasMore}
      loadingMore={loadingMore}
      className="fixed inset-0 overflow-auto bg-[#0e0e0e] py-4"
      emptyState={
        <div className="fixed inset-0 bg-[#0e0e0e] p-4 font-mono text-xs text-gray-600">
          {isConnecting ? "Connecting to log stream..." : "No logs available"}
        </div>
      }
    />
  );
}
