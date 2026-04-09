import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";

export function DockerComposeLogsPopout() {
  const { nodeId, project } = useParams<{ nodeId: string; project: string }>();
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [, setContainers] = useState<
    Array<{ id: string; name: string; service: string; state: string }>
  >([]);

  // Color palette for compose services
  const colors = [
    "\x1b[36m", // cyan
    "\x1b[33m", // yellow
    "\x1b[32m", // green
    "\x1b[35m", // magenta
    "\x1b[34m", // blue
    "\x1b[91m", // bright red
    "\x1b[92m", // bright green
    "\x1b[93m", // bright yellow
  ];
  const serviceColorMap = useRef(new Map<string, string>());
  const getServiceColor = (service: string) => {
    if (!serviceColorMap.current.has(service)) {
      serviceColorMap.current.set(service, colors[serviceColorMap.current.size % colors.length]);
    }
    return serviceColorMap.current.get(service)!;
  };

  useEffect(() => {
    if (project) document.title = `Compose Logs — ${project}`;
  }, [project]);

  const connect = useCallback(async () => {
    if (!nodeId || !project) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (!mountedRef.current) return;

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

    if (!terminalRef.current) {
      const terminal = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        theme: { background: "#0e0e0e", foreground: "#e0e0e0" },
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      setTimeout(() => fitAddon.fit(), 50);
      terminalRef.current = terminal;

      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          /* */
        }
      });
      resizeObserver.observe(termRef.current);

      cleanupRef.current = () => {
        resizeObserver.disconnect();
        terminal.dispose();
        wsRef.current?.close();
        terminalRef.current = null;
        wsRef.current = null;
      };
    }

    const terminal = terminalRef.current;
    terminal.write(`\x1b[90mConnecting to compose project "${project}"...\x1b[0m\r\n`);

    const sessionId = useAuthStore.getState().sessionId;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/docker/nodes/${nodeId}/compose/${encodeURIComponent(project)}/logs/stream?token=${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "connected") {
          setContainers(msg.containers ?? []);
          terminal.write(
            `\x1b[90m${msg.containers?.length ?? 0} containers in project\x1b[0m\r\n\r\n`
          );
        } else if (msg.type === "initial" || msg.type === "new") {
          const lines: string[] = msg.lines ?? [];
          for (const line of lines) {
            // Lines are "service | timestamp content"
            const pipeIdx = line.indexOf(" | ");
            if (pipeIdx > 0) {
              const service = line.slice(0, pipeIdx);
              const rest = line.slice(pipeIdx + 3);
              const color = getServiceColor(service);
              // Pad service name to 20 chars for alignment
              const padded = service.padEnd(15);
              terminal.write(`${color}${padded}\x1b[0m \x1b[90m│\x1b[0m ${rest}\r\n`);
            } else {
              terminal.write(line + "\r\n");
            }
          }
        } else if (msg.type === "error") {
          terminal.write(`\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        /* */
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      terminal.write(`\r\n\x1b[90mConnection lost. Reconnecting...\x1b[0m\r\n`);
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 3000);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      terminal.write(`\r\n\x1b[31mConnection error.\x1b[0m\r\n`);
    };
  }, [nodeId, project]);

  const didConnect = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!didConnect.current) {
      didConnect.current = true;
      connect();
    }
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [connect]);

  return <div ref={termRef} className="fixed inset-0 bg-[#0e0e0e]" style={{ padding: 4 }} />;
}
