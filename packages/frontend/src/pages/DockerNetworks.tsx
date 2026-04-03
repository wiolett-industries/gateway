import { Network, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerNetwork, Node } from "@/types";

export function DockerNetworks() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const {
    networks,
    selectedNodeId,
    isLoading,
    setSelectedNode,
    fetchNetworks,
  } = useDockerStore();

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("bridge");
  const [createSubnet, setCreateSubnet] = useState("");
  const [createGateway, setCreateGateway] = useState("");
  const [creating, setCreating] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageNetwork, setUsageNetwork] = useState("");
  const [usageContainers, setUsageContainers] = useState<Array<{ id: string; name: string; state: string }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = async (net: DockerNetwork) => {
    setUsageNetwork(net.name);
    setUsageOpen(true);
    setUsageLoading(true);
    try {
      const c = (net as any).containers ?? (net as any).Containers ?? {};
      const containerIds = Object.keys(c);
      const containers = await api.listDockerContainers(selectedNodeId!);
      const matched = (containers ?? [])
        .filter((ct: any) => containerIds.includes(ct.id))
        .map((ct: any) => ({ id: ct.id, name: (ct.name ?? "").replace(/^\//, ""), state: ct.state }));
      setUsageContainers(matched);
    } catch {
      setUsageContainers([]);
    }
    setUsageLoading(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    setNodesLoading(true);
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) => {
        setDockerNodes(r.data);
        if (!selectedNodeId && r.data.length > 0) {
          setSelectedNode(r.data[0].id);
        }
      })
      .catch(() => toast.error("Failed to load Docker nodes"))
      .finally(() => setNodesLoading(false));
  }, []);

  const location = useLocation();
  useEffect(() => {
    if (!selectedNodeId) return;
    fetchNetworks();
    const interval = setInterval(() => fetchNetworks(), 30_000);
    return () => clearInterval(interval);
  }, [selectedNodeId, fetchNetworks, location.key]);

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

  const containerCount = (net: DockerNetwork): number => {
    const c = (net as any).containers ?? (net as any).Containers;
    return c ? Object.keys(c).length : 0;
  };

  const getIPAM = (net: DockerNetwork): { subnet: string; gateway: string } => {
    const ipam = (net as any).ipam ?? (net as any).IPAM;
    const cfg = ipam?.Config?.[0] ?? ipam?.config?.[0] ?? {};
    return {
      subnet: cfg.Subnet ?? cfg.subnet ?? "-",
      gateway: cfg.Gateway ?? cfg.gateway ?? "-",
    };
  };

  const handleRemove = async (net: DockerNetwork) => {
    const count = containerCount(net);
    const extra = count > 0 ? ` ${count} container${count > 1 ? "s are" : " is"} currently connected.` : "";
    const ok = await confirm({
      title: "Remove Network",
      description: `Remove network "${net.name}"?${extra} This cannot be undone.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.removeNetwork(selectedNodeId!, net.id);
      toast.success("Network removed");
      fetchNetworks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove network");
    }
  };

  const handleCreate = async () => {
    if (!selectedNodeId || !createName.trim()) return;
    setCreating(true);
    try {
      await api.createNetwork(selectedNodeId, {
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

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Networks</h1>
              {!isLoading && selectedNodeId && (
                <Badge variant="secondary">{networks.length}</Badge>
              )}
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
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Create Network
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Inline: [Node selector] [Search input] */}
        <div className="flex gap-2">
          <Select
            value={selectedNodeId ?? ""}
            onValueChange={(v) => setSelectedNode(v || null)}
            disabled={nodesLoading}
          >
            <SelectTrigger className="w-48 shrink-0">
              <SelectValue placeholder={nodesLoading ? "Loading..." : "Select node"} />
            </SelectTrigger>
            <SelectContent>
              {dockerNodes.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        n.status === "online"
                          ? "bg-emerald-500"
                          : n.status === "error"
                            ? "bg-red-400"
                            : "bg-muted-foreground/40"
                      }`}
                    />
                    {n.displayName || n.hostname}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search networks by name or driver..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {!selectedNodeId && !nodesLoading && dockerNodes.length === 0 && (
          <EmptyState message="No Docker nodes registered. Add a Docker node from the Nodes page." />
        )}
        {!selectedNodeId && !nodesLoading && dockerNodes.length > 0 && (
          <EmptyState message="Select a node to view its networks." />
        )}

        {selectedNodeId && (
          <>

            {filteredNetworks.length > 0 ? (
              <div className="border border-border rounded-lg bg-card">
                <div className="hidden md:grid md:grid-cols-[1fr_100px_80px_160px_160px_80px_80px] gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Name</span>
                  <span>Driver</span>
                  <span>Scope</span>
                  <span>Subnet</span>
                  <span>Gateway</span>
                  <span>Usage</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredNetworks.map((net) => {
                    const count = containerCount(net);
                    const ipam = getIPAM(net);
                    return (
                      <div
                        key={net.id}
                        className="flex flex-col md:grid md:grid-cols-[1fr_100px_80px_160px_160px_80px_80px] gap-2 md:gap-4 p-4 items-start md:items-center"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                            <Network className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{net.name}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {net.id.slice(0, 12)}
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-xs w-fit">
                          {net.driver}
                        </Badge>
                        <Badge variant="secondary" className="text-xs uppercase w-fit">{net.scope}</Badge>
                        {ipam.subnet !== "-" ? (
                          <Badge variant="secondary" className="text-xs font-mono w-fit">{ipam.subnet}</Badge>
                        ) : <span className="text-xs text-muted-foreground">-</span>}
                        {ipam.gateway !== "-" ? (
                          <Badge variant="secondary" className="text-xs font-mono w-fit">{ipam.gateway}</Badge>
                        ) : <span className="text-xs text-muted-foreground">-</span>}
                        {count > 0 ? (
                          <Badge
                            variant="success"
                            className="text-xs w-fit cursor-pointer hover:opacity-80"
                            onClick={() => showUsage(net)}
                          >
                            In use
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs w-fit">
                            Unused
                          </Badge>
                        )}
                        <div className="flex items-center md:justify-end">
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                Loading networks...
              </div>
            ) : (
              <EmptyState
                message="No networks found on this node."
                hasActiveFilters={search !== ""}
                onReset={() => setSearch("")}
                actionLabel={hasScope("docker:networks:create") ? "Create a network" : undefined}
                onAction={hasScope("docker:networks:create") ? () => setCreateOpen(true) : undefined}
              />
            )}
          </>
        )}
      </div>

      {/* Create Network Dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Network</DialogTitle>
            <DialogDescription>
              Create a new network on {selectedNode?.displayName || selectedNode?.hostname || "the selected node"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
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
                  <Badge variant={c.state === "running" ? "success" : "secondary"} className="text-xs shrink-0">
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
    </PageTransition>
  );
}
