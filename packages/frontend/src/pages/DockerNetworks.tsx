import { Network, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TruncateStart } from "@/components/ui/truncate-start";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerNetwork, Node } from "@/types";
import { isNodeIncompatible } from "@/types";

export function DockerNetworks({
  embedded,
  onCreateRef,
  fixedNodeId,
}: {
  embedded?: boolean;
  onCreateRef?: (fn: () => void) => void;
  fixedNodeId?: string;
} = {}) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const { networks, selectedNodeId, isLoading, setSelectedNode, fetchNetworks } = useDockerStore();
  const visibleNodeId = fixedNodeId ?? selectedNodeId;

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [search, setSearch] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createNodeId, setCreateNodeId] = useState<string>("");
  const openCreate = useCallback(() => {
    setCreateNodeId(selectedNodeId || "");
    setCreateOpen(true);
  }, [selectedNodeId]);
  useEffect(() => {
    onCreateRef?.(() => openCreate());
  }, [onCreateRef, openCreate]);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("bridge");
  const [createSubnet, setCreateSubnet] = useState("");
  const [createGateway, setCreateGateway] = useState("");
  const [creating, setCreating] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageNetwork, setUsageNetwork] = useState("");
  const [usageContainers, setUsageContainers] = useState<
    Array<{ id: string; name: string; state: string }>
  >([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = useCallback(
    async (net: DockerNetwork) => {
      const nid = (net as any)._nodeId || selectedNodeId;
      if (!nid) return;
      setUsageNetwork(net.name);
      setUsageOpen(true);
      setUsageLoading(true);
      try {
        const c = (net as any).containers ?? (net as any).Containers ?? {};
        const containerIds = Object.keys(c);
        const containers = await api.listDockerContainers(nid);
        const matched = (containers ?? [])
          .filter((ct: any) => containerIds.includes(ct.id))
          .map((ct: any) => ({
            id: ct.id,
            name: (ct.name ?? "").replace(/^\//, ""),
            state: ct.state,
          }));
        setUsageContainers(matched);
      } catch {
        setUsageContainers([]);
      }
      setUsageLoading(false);
    },
    [selectedNodeId]
  );

  const loadNetworkNodes = useCallback(async () => {
    if (embedded && !fixedNodeId) {
      return;
    }
    if (fixedNodeId) {
      setSelectedNode(fixedNodeId);
      return;
    }

    try {
      const r = await api.listNodes({ type: "docker", limit: 100 });
      const onlineNodes = r.data.filter((n) => n.status === "online" && !isNodeIncompatible(n));
      setDockerNodes(onlineNodes);
      useDockerStore.getState().setDockerNodes(onlineNodes);
    } catch {
      toast.error("Failed to load Docker nodes");
    }
  }, [embedded, fixedNodeId, setSelectedNode]);

  useEffect(() => {
    void loadNetworkNodes();
  }, [loadNetworkNodes]);

  useEffect(() => {
    if (!visibleNodeId) return;
    fetchNetworks(fixedNodeId);
    const interval = setInterval(() => fetchNetworks(fixedNodeId), 30_000);
    return () => clearInterval(interval);
  }, [fetchNetworks, fixedNodeId, visibleNodeId]);

  useRealtime("docker.network.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (visibleNodeId && ev?.nodeId && ev.nodeId !== visibleNodeId) return;
    fetchNetworks(fixedNodeId);
  });

  const filteredNetworks = useMemo(() => {
    const sorted = [...networks].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.driver.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q)
    );
  }, [networks, search]);

  const containerCount = useCallback((net: DockerNetwork): number => {
    const c = (net as any).containers ?? (net as any).Containers;
    return c ? Object.keys(c).length : 0;
  }, []);

  const getIPAM = useCallback((net: DockerNetwork): { subnet: string; gateway: string } => {
    const ipam = (net as any).ipam ?? (net as any).IPAM;
    const cfg = ipam?.Config?.[0] ?? ipam?.config?.[0] ?? {};
    return {
      subnet: cfg.Subnet ?? cfg.subnet ?? "-",
      gateway: cfg.Gateway ?? cfg.gateway ?? "-",
    };
  }, []);

  const handleRemove = useCallback(
    async (net: DockerNetwork & { _nodeId?: string }) => {
      const count = containerCount(net);
      const extra =
        count > 0 ? ` ${count} container${count > 1 ? "s are" : " is"} currently connected.` : "";
      const ok = await confirm({
        title: "Remove Network",
        description: `Remove network "${net.name}"?${extra} This cannot be undone.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
      try {
        const nid = net._nodeId || selectedNodeId;
        if (!nid) return;
        await api.removeNetwork(nid, net.id);
        toast.success("Network removed");
        fetchNetworks();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove network");
      }
    },
    [containerCount, fetchNetworks, selectedNodeId]
  );

  const handleCreate = async () => {
    if (!createNodeId || !createName.trim()) return;
    setCreating(true);
    try {
      await api.createNetwork(createNodeId, {
        name: createName.trim(),
        driver: createDriver,
        subnet: createSubnet.trim() || undefined,
        gateway: createGateway.trim() || undefined,
      });
      toast.success("Network created");
      closeCreate();
      fetchNetworks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create network");
    } finally {
      setCreating(false);
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateName("");
    setCreateDriver("bridge");
    setCreateSubnet("");
    setCreateGateway("");
  };

  const selectedNode = dockerNodes.find((n) => n.id === selectedNodeId);

  const allNetworkColumns: DataTableColumn<DockerNetwork>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        render: (net) => (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
              <Network className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <TruncateStart text={net.name} className="text-sm font-medium" />
              <p className="text-xs text-muted-foreground font-mono truncate">
                {net.id.slice(0, 12)}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: "driver",
        header: "Driver",
        render: (net) => <span className="text-sm text-muted-foreground">{net.driver}</span>,
      },
      {
        key: "subnet",
        header: "Subnet",
        render: (net) => {
          const ipam = getIPAM(net);
          return ipam.subnet !== "-" ? (
            <Badge variant="secondary" className="text-xs font-mono w-fit">
              {ipam.subnet}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          );
        },
      },
      {
        key: "node",
        header: "Node",
        width: "minmax(210px, 0.8fr)",
        render: (n) => (
          <div className="min-w-0 flex">
            <Badge
              variant="secondary"
              className="text-xs max-w-full overflow-hidden text-ellipsis whitespace-nowrap inline-flex"
            >
              {(n as any)._nodeName || "-"}
            </Badge>
          </div>
        ),
      },
      {
        key: "usage",
        header: "Usage",
        render: (net) => {
          const count = containerCount(net);
          return count > 0 ? (
            <Badge
              variant="success"
              className="text-xs w-fit cursor-pointer hover:opacity-80"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                showUsage(net);
              }}
            >
              In use
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs w-fit">
              Unused
            </Badge>
          );
        },
      },
      {
        key: "actions",
        header: "Actions",
        align: "right" as const,
        render: (net) => {
          const count = containerCount(net);
          return (
            <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              {hasScope("docker:networks:delete") && count === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleRemove(net)}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [hasScope, handleRemove, showUsage, containerCount, getIPAM]
  );
  const networkColumns = fixedNodeId
    ? allNetworkColumns.filter((c) => c.key !== "node")
    : allNetworkColumns;

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Networks</h1>
              {!isLoading && selectedNodeId && <Badge variant="secondary">{networks.length}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage Docker networks across your nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <>
                <RefreshButton onClick={() => fetchNetworks()} disabled={isLoading} />
                {hasScope("docker:networks:create") && (
                  <Button onClick={() => openCreate()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Create Network
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search networks by name or driver..."
        hasActiveFilters={search !== "" || !!selectedNodeId}
        onReset={() => {
          setSearch("");
          setSelectedNode(null);
        }}
        filters={
          <Select
            value={selectedNodeId ?? "__all__"}
            onValueChange={(v) => setSelectedNode(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All nodes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All nodes</SelectItem>
              {(embedded ? useDockerStore.getState().dockerNodes : dockerNodes).map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.displayName || n.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {filteredNetworks.length > 0 ? (
        <DataTable
          columns={networkColumns}
          data={filteredNetworks}
          keyFn={(net) => net.id}
          emptyMessage="No networks found."
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          Loading networks...
        </div>
      ) : (
        <EmptyState
          message="No networks found."
          hasActiveFilters={search !== ""}
          onReset={() => setSearch("")}
          actionLabel={hasScope("docker:networks:create") ? "Create a network" : undefined}
          onAction={hasScope("docker:networks:create") ? () => openCreate() : undefined}
        />
      )}

      {/* Create Network Dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Network</DialogTitle>
            <DialogDescription>
              Create a new network on{" "}
              {selectedNode?.displayName || selectedNode?.hostname || "the selected node"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Node <span className="text-destructive">*</span>
              </label>
              <Select value={createNodeId} onValueChange={setCreateNodeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a node" />
                </SelectTrigger>
                <SelectContent>
                  {(useDockerStore.getState().dockerNodes.length > 0
                    ? useDockerStore.getState().dockerNodes
                    : dockerNodes
                  ).map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.displayName || n.hostname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-network"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Driver</label>
              <Select value={createDriver} onValueChange={setCreateDriver}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bridge">bridge</SelectItem>
                  <SelectItem value="overlay">overlay</SelectItem>
                  <SelectItem value="host">host</SelectItem>
                  <SelectItem value="macvlan">macvlan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Subnet <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                className="mt-1"
                value={createSubnet}
                onChange={(e) => setCreateSubnet(e.target.value)}
                placeholder="172.20.0.0/16"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                Gateway <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                className="mt-1"
                value={createGateway}
                onChange={(e) => setCreateGateway(e.target.value)}
                placeholder="172.20.0.1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !createName.trim() || !createNodeId}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Usage Dialog */}
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Containers on this network</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{usageNetwork}</span>
            </DialogDescription>
          </DialogHeader>
          {usageLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : usageContainers.length > 0 ? (
            <div className="divide-y divide-border border border-border rounded-md overflow-hidden">
              {usageContainers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-4 py-3 bg-card hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => {
                    setUsageOpen(false);
                    navigate(`/docker/containers/${selectedNodeId}/${c.id}`);
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{c.id.slice(0, 12)}</p>
                  </div>
                  <Badge
                    variant={c.state === "running" ? "success" : "secondary"}
                    className="text-xs shrink-0"
                  >
                    {c.state}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No containers found on this network.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return <div className="flex flex-col flex-1 min-h-0 space-y-4">{content}</div>;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">{content}</div>
    </PageTransition>
  );
}
