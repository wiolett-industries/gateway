import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PopoutTerminal } from "@/components/terminal/PopoutTerminal";
import { api } from "@/services/api";

export function DockerConsolePopout() {
  const { nodeId, containerId } = useParams<{ nodeId: string; containerId: string }>();
  const [searchParams] = useSearchParams();
  const shell = searchParams.get("shell") || "auto";

  const wsFactory = useCallback(
    () => api.createExecWebSocket(nodeId!, containerId!, shell),
    [nodeId, containerId, shell]
  );

  if (!nodeId || !containerId) return null;

  return (
    <PopoutTerminal
      wsFactory={wsFactory}
      channelKey={`docker-console:${containerId}`}
      title={`Console — ${containerId.slice(0, 12)}`}
    />
  );
}
