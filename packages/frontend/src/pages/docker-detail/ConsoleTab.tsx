import { useAuthStore } from "@/stores/auth";
import { api } from "@/services/api";
import { TerminalConsole } from "@/components/terminal/TerminalConsole";
import { useCallback } from "react";

export function ConsoleTab({ nodeId, containerId }: { nodeId: string; containerId: string }) {
  const { hasScope } = useAuthStore();

  const wsFactory = useCallback(
    () => api.createExecWebSocket(nodeId, containerId, "auto"),
    [nodeId, containerId]
  );

  if (!hasScope("docker:containers:console")) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        You don't have permission to access the console.
      </div>
    );
  }

  return (
    <TerminalConsole
      wsFactory={wsFactory}
      channelKey={`docker-console:${containerId}`}
      popoutUrl={`/docker/console/${nodeId}/${containerId}?shell=auto`}
      connectLabel={containerId.slice(0, 12)}
    />
  );
}
