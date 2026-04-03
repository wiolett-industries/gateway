import { ExternalLink, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

const CHANNEL_PREFIX = "docker-console:";

export function ConsoleTab({ nodeId, containerId }: { nodeId: string; containerId: string }) {
  const { hasScope } = useAuthStore();
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<any>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const gotFirstOutput = useRef(false);
  const isReconnect = useRef(false);

  // ── Popout tracking via BroadcastChannel ──
  const [isPopout, setIsPopout] = useState(false);
  const isPopoutRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const popoutAliveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_PREFIX + containerId);
    channelRef.current = channel;

    const markAlive = () => {
      isPopoutRef.current = true;
      setIsPopout(true);
      // Reset the alive timer — if no heartbeat within 4s, consider popout dead
      if (popoutAliveTimer.current) clearTimeout(popoutAliveTimer.current);
      popoutAliveTimer.current = setTimeout(() => {
        isPopoutRef.current = false;
        setIsPopout(false);
      }, 4000);
    };

    channel.onmessage = (evt) => {
      const { type } = evt.data ?? {};
      if (type === "popout-open" || type === "heartbeat" || type === "pong") {
        markAlive();
      }
      if (type === "popout-close") {
        isPopoutRef.current = false;
        setIsPopout(false);
        if (popoutAliveTimer.current) clearTimeout(popoutAliveTimer.current);
      }
    };

    // On mount, ping to check if a popout is already open
    channel.postMessage({ type: "ping" });

    return () => {
      channel.close();
      channelRef.current = null;
      if (popoutAliveTimer.current) clearTimeout(popoutAliveTimer.current);
    };
  }, [containerId]);

  const openPopout = useCallback(() => {
    const url = `/docker/console/${nodeId}/${containerId}?shell=auto`;
    window.open(url, `console-${containerId}`, "width=900,height=600,menubar=no,toolbar=no");

    // Close our own terminal connection to avoid duplicate
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

    // Mark as popout — the BroadcastChannel will confirm
    isPopoutRef.current = true;
    setIsPopout(true);
  }, [nodeId, containerId]);

  const bringBack = useCallback(() => {
    // Tell the popout window to close
    channelRef.current?.postMessage({ type: "request-close" });
    isPopoutRef.current = false;
    setIsPopout(false);
    if (popoutAliveTimer.current) clearTimeout(popoutAliveTimer.current);
    // Reconnection is handled by the isPopout→false useEffect below
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!mountedRef.current) return;

    // Lazy-load xterm
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]);

    if (!document.querySelector("link[data-xterm-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.xtermCss = "true";
      link.href = new URL("@xterm/xterm/css/xterm.css", import.meta.url).href;
      document.head.appendChild(link);
    }

    if (!termRef.current || !mountedRef.current) return;

    // Create terminal only once
    if (!terminalRef.current) {
      const terminal = new Terminal({
        cursorBlink: true,
        theme: { background: "#0e0e0e", foreground: "#e0e0e0" },
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      setTimeout(() => { fitAddon.fit(); terminal.focus(); }, 50);
      terminalRef.current = terminal;
      fitRef.current = fitAddon;

      const resizeObserver = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch { /* */ }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
        }
      });
      resizeObserver.observe(termRef.current);

      const dataDisposable = terminal.onData((data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data: btoa(data) }));
        }
      });

      cleanupRef.current = () => {
        resizeObserver.disconnect();
        dataDisposable.dispose();
        terminal.dispose();
        wsRef.current?.close();
        terminalRef.current = null;
        fitRef.current = null;
        wsRef.current = null;
      };
    }

    const terminal = terminalRef.current;

    // On first connect, show connecting message. On reconnect, don't clear the terminal.
    if (!isReconnect.current) {
      gotFirstOutput.current = false;
      const shortId = containerId.slice(0, 12);
      terminal.write(`Connecting to ${shortId}...\r\n`);
    } else {
      // Reconnect: write a subtle reconnecting indicator
      terminal.write(`\r\n[reconnecting...]\r\n`);
    }

    const ws = api.createExecWebSocket(nodeId, containerId, "auto");
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      terminal.focus();
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
        }
      }, 100);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "connected") {
          if (msg.isNew) {
            // Brand new session — show shell info, will clear on first output
            const shellName = (msg.shell ?? "/bin/sh").split("/").pop();
            terminal.write(`Using ${shellName}...\r\n`);
            gotFirstOutput.current = false;
          } else {
            // Reattached to existing session — clear the "Connecting..." text, show buffer
            terminal.clear();
            gotFirstOutput.current = true;
          }
        } else if (msg.type === "output") {
          // Clear terminal before first real output only for new sessions
          if (!gotFirstOutput.current) {
            gotFirstOutput.current = true;
            terminal.clear();
          }
          const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
          terminal.write(bytes);
        } else if (msg.type === "exit") {
          terminal.write(`\r\nProcess exited (code ${msg.exitCode}). Reconnecting...\r\n`);
          isReconnect.current = false; // Next connect creates fresh session
          scheduleReconnect();
        } else if (msg.type === "error") {
          terminal.write(`\r\nError: ${msg.message}\r\n`);
        }
      } catch { /* */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      terminal.write(`\r\nConnection lost. Reconnecting...\r\n`);
      isReconnect.current = true;
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      terminal.write(`\r\nConnection error. Reconnecting...\r\n`);
      isReconnect.current = true;
      scheduleReconnect();
    };
  }, [nodeId, containerId]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, 3000);
  }, [connect]);

  // Auto-connect on mount only (skip if popout is detected)
  const didConnect = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: must run only once on mount
  useEffect(() => {
    mountedRef.current = true;

    // Delay initial connect slightly to allow BroadcastChannel ping/pong
    const startTimer = setTimeout(() => {
      if (!didConnect.current && !isPopoutRef.current) {
        didConnect.current = true;
        connect();
      }
    }, 200);

    return () => {
      clearTimeout(startTimer);
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // If popout opens after we already connected, disconnect
  useEffect(() => {
    if (isPopout && wsRef.current) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    }
  }, [isPopout]);

  // If popout closes naturally, reconnect
  useEffect(() => {
    if (!isPopout && didConnect.current && !wsRef.current && mountedRef.current) {
      isReconnect.current = true;
      connect();
    }
  }, [isPopout, connect]);

  if (!hasScope("docker:exec")) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        You don't have permission to access the console.
      </div>
    );
  }

  // ── Popout active: show placeholder ──
  if (isPopout) {
    return (
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0 bg-[#0e0e0e] rounded-md border border-border flex flex-col items-center justify-center gap-4">
          <Terminal className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Console is open in a separate window
          </p>
          <Button variant="outline" size="sm" onClick={bringBack}>
            Bring back here
          </Button>
        </div>
      </div>
    );
  }

  // ── Normal console ──
  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={termRef}
        className="absolute inset-0 bg-[#0e0e0e] rounded-md overflow-hidden border border-border p-2"
      />
      {/* Popout button */}
      <div className="absolute right-2.5 bottom-2.5 z-10">
        <Button
          variant="outline"
          size="sm"
          onClick={openPopout}
        >
          <ExternalLink className="h-4 w-4" />
          Pop out
        </Button>
      </div>
    </div>
  );
}
