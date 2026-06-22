import { Plus, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "@/components/common/PanelShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useDockerStore } from "@/stores/docker";
import type { DockerNetwork } from "@/types";

function normalizeDockerNetwork(network: DockerNetwork | Record<string, unknown>): DockerNetwork {
  const raw = network as Record<string, unknown>;
  return {
    id: String(raw.id ?? raw.Id ?? ""),
    name: String(raw.name ?? raw.Name ?? ""),
    driver: String(raw.driver ?? raw.Driver ?? ""),
    scope: String(raw.scope ?? raw.Scope ?? ""),
    ipam: (raw.ipam ?? raw.IPAM ?? undefined) as DockerNetwork["ipam"],
    containers: (raw.containers ?? raw.Containers ?? undefined) as DockerNetwork["containers"],
  };
}

interface AttachedNetwork {
  name: string;
  networkId: string;
  ipAddress: string;
  gateway: string;
  aliases: string[];
}

function readAttachedNetworks(
  networks: Record<string, Record<string, unknown>> = {}
): AttachedNetwork[] {
  return Object.entries(networks).map(([name, config]) => ({
    name,
    networkId: String(config.NetworkID ?? ""),
    ipAddress: String(config.IPAddress ?? ""),
    gateway: String(config.Gateway ?? ""),
    aliases: Array.isArray(config.Aliases)
      ? (config.Aliases as unknown[]).map((alias) => String(alias))
      : [],
  }));
}

function isBuiltInDockerNetwork(name: string) {
  return ["bridge", "host", "none"].includes(name);
}

export function NetworksSection({
  nodeId,
  containerId,
  networks,
  canManageNetworks,
  canListNetworks,
  onRefresh,
}: {
  nodeId: string;
  containerId: string;
  networks?: Record<string, Record<string, unknown>>;
  canManageNetworks: boolean;
  canListNetworks: boolean;
  onRefresh?: () => void | Promise<void>;
}) {
  const invalidate = useDockerStore((s) => s.invalidate);
  const [allNetworks, setAllNetworks] = useState<DockerNetwork[]>([]);
  const [networksLoading, setNetworksLoading] = useState(false);
  const [networkActionLoading, setNetworkActionLoading] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [addingNetwork, setAddingNetwork] = useState(false);

  const attachedNetworks = useMemo(() => readAttachedNetworks(networks), [networks]);
  const attachedNames = useMemo(
    () => new Set(attachedNetworks.map((network) => network.name)),
    [attachedNetworks]
  );
  const availableNetworks = useMemo(
    () => allNetworks.filter((network) => !attachedNames.has(network.name)),
    [allNetworks, attachedNames]
  );

  const loadNetworks = useCallback(async () => {
    if (!canListNetworks) return;
    setNetworksLoading(true);
    try {
      const rows = await api.listDockerNetworks(nodeId);
      setAllNetworks((rows ?? []).map((network) => normalizeDockerNetwork(network)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load networks");
    } finally {
      setNetworksLoading(false);
    }
  }, [canListNetworks, nodeId]);

  useEffect(() => {
    if (!canListNetworks) return;
    void loadNetworks();
  }, [canListNetworks, loadNetworks]);

  useEffect(() => {
    if (availableNetworks.length === 0) {
      setSelectedNetworkId("");
      setAddingNetwork(false);
      return;
    }
    if (!availableNetworks.some((network) => network.id === selectedNetworkId)) {
      setSelectedNetworkId(availableNetworks[0]?.id ?? "");
    }
  }, [availableNetworks, selectedNetworkId]);

  useRealtime("docker.network.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (!ev || ev.nodeId !== nodeId) return;
    void loadNetworks();
  });

  const refreshAfterNetworkChange = useCallback(async () => {
    await invalidate("containers", "networks");
    await Promise.all([loadNetworks(), Promise.resolve(onRefresh?.())]);
  }, [invalidate, loadNetworks, onRefresh]);

  const handleConnectNetwork = useCallback(async () => {
    if (!selectedNetworkId) return;
    setNetworkActionLoading(`connect:${selectedNetworkId}`);
    try {
      await api.connectContainerToNetwork(nodeId, selectedNetworkId, containerId);
      toast.success("Network connected");
      setAddingNetwork(false);
      await refreshAfterNetworkChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect network");
    } finally {
      setNetworkActionLoading(null);
    }
  }, [containerId, nodeId, refreshAfterNetworkChange, selectedNetworkId]);

  const handleDisconnectNetwork = useCallback(
    async (networkId: string, networkName: string) => {
      setNetworkActionLoading(`disconnect:${networkId}`);
      try {
        await api.disconnectContainerFromNetwork(nodeId, networkId, containerId);
        toast.success(`Disconnected from ${networkName}`);
        await refreshAfterNetworkChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to disconnect network");
      } finally {
        setNetworkActionLoading(null);
      }
    },
    [containerId, nodeId, refreshAfterNetworkChange]
  );

  return (
    <PanelShell
      title="Networks"
      description="Connect this container to additional Docker networks"
      actions={
        canManageNetworks && canListNetworks ? (
          <Button
            size="sm"
            onClick={() => setAddingNetwork(true)}
            disabled={addingNetwork || networksLoading || availableNetworks.length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        ) : null
      }
    >
      {attachedNetworks.length > 0 || addingNetwork ? (
        <>
          <div
            className={`grid ${
              canManageNetworks
                ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                : "grid-cols-[minmax(0,1fr)_120px_120px]"
            } border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}
          >
            <div className="px-3 py-2">Network</div>
            <div className="px-3 py-2 border-l border-border">IP</div>
            <div className="px-3 py-2 border-l border-border">Gateway</div>
            {canManageNetworks && <div />}
          </div>
          <div>
            {attachedNetworks.map((network) => (
              <div
                key={`${network.name}:${network.networkId}`}
                className={`grid ${
                  canManageNetworks
                    ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                    : "grid-cols-[minmax(0,1fr)_120px_120px]"
                } border-b border-border last:border-b-0`}
              >
                <div className="flex min-w-0 items-center px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{network.name}</span>
                    {network.aliases.length > 0 && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {network.aliases.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center border-l border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                  <span className="truncate">{network.ipAddress || "-"}</span>
                </div>
                <div className="flex items-center border-l border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                  <span className="truncate">{network.gateway || "-"}</span>
                </div>
                {canManageNetworks && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                    disabled={
                      !!networkActionLoading ||
                      !network.networkId ||
                      isBuiltInDockerNetwork(network.name)
                    }
                    onClick={() => handleDisconnectNetwork(network.networkId, network.name)}
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {addingNetwork && (
              <div
                className={`grid ${
                  canManageNetworks
                    ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                    : "grid-cols-[minmax(0,1fr)_120px_120px]"
                } border-b border-border last:border-b-0`}
              >
                <div className="min-w-0">
                  <Select
                    value={selectedNetworkId}
                    onValueChange={setSelectedNetworkId}
                    disabled={
                      !canManageNetworks || networksLoading || availableNetworks.length === 0
                    }
                  >
                    <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                      <SelectValue
                        placeholder={networksLoading ? "Loading networks..." : "Select a network"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableNetworks.map((network) => (
                        <SelectItem key={network.id} value={network.id}>
                          {network.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center border-l border-border px-3 py-2 text-xs text-muted-foreground">
                  -
                </div>
                <div className="flex items-center border-l border-border px-3 py-2 text-xs text-muted-foreground">
                  -
                </div>
                {canManageNetworks && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                    disabled={!selectedNetworkId || networksLoading || !!networkActionLoading}
                    onClick={handleConnectNetwork}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-sm">No networks</div>
      )}
    </PanelShell>
  );
}
