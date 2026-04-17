import { useCallback } from "react";
import { TerminalConsole } from "@/components/terminal/TerminalConsole";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

export function ConsoleTab({ nodeId, containerId }: { nodeId: string; containerId: string }) {
  const { hasScope } = useAuthStore();
  const canUseConsole =
    hasScope("docker:containers:console") || hasScope(`docker:containers:console:${nodeId}`);

  const wsFactory = useCallback(
    () => api.createExecWebSocket(nodeId, containerId, "auto"),
    [nodeId, containerId]
  );

  if (!canUseConsole) {
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
