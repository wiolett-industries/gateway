import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { PopoutTerminal } from "@/components/terminal/PopoutTerminal";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

export function NodeConsolePopout() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const { hasScope } = useAuthStore();

  const wsFactory = useCallback(() => api.createNodeExecWebSocket(nodeId!, "auto"), [nodeId]);

  if (!nodeId) return null;
  if (!hasScope("nodes:console") && !hasScope(`nodes:console:${nodeId}`)) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        You don't have permission to access the node console.
      </div>
    );
  }

  return (
    <PopoutTerminal
      wsFactory={wsFactory}
      channelKey={`node-console:${nodeId}`}
      title={`Node Console — ${nodeId.slice(0, 8)}`}
    />
  );
}
