import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { PopoutTerminal } from "@/components/terminal/PopoutTerminal";
import { api } from "@/services/api";

export function NodeConsolePopout() {
  const { nodeId } = useParams<{ nodeId: string }>();

  const wsFactory = useCallback(() => api.createNodeExecWebSocket(nodeId!, "auto"), [nodeId]);

  if (!nodeId) return null;

  return (
    <PopoutTerminal
      wsFactory={wsFactory}
      channelKey={`node-console:${nodeId}`}
      title={`Node Console — ${nodeId.slice(0, 8)}`}
    />
  );
}
