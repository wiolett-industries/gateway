import { useCallback } from "react";
import { TerminalConsole } from "@/components/terminal/TerminalConsole";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

export function NodeConsoleTab({ nodeId }: { nodeId: string }) {
  const { hasScope } = useAuthStore();

  const wsFactory = useCallback(() => api.createNodeExecWebSocket(nodeId, "auto"), [nodeId]);

  if (!hasScope("nodes:console")) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        You don't have permission to access the node console.
      </div>
    );
  }

  return (
    <TerminalConsole
      wsFactory={wsFactory}
      channelKey={`node-console:${nodeId}`}
      popoutUrl={`/nodes/console/${nodeId}?shell=auto`}
      connectLabel="node"
    />
  );
}
