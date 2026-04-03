import { Database, Minus, Plus, Search, Trash2 } from "lucide-react";
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
import type { Node } from "@/types";

interface LabelEntry {
  key: string;
  value: string;
}

export function DockerVolumes() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const {
    volumes,
    selectedNodeId,
    isLoading,
    setSelectedNode,
    fetchVolumes,
  } = useDockerStore();

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("local");
  const [createLabels, setCreateLabels] = useState<LabelEntry[]>([]);
  const [creating, setCreating] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageVolume, setUsageVolume] = useState("");
  const [usageContainers, setUsageContainers] = useState<Array<{ id: string; name: string; state: string }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = async (volumeName: string, containerNames: string[]) => {
    setUsageVolume(volumeName);
    setUsageOpen(true);
    setUsageLoading(true);
    try {
      const containers = await api.listDockerContainers(selectedNodeId!);
      const matched = (containers ?? [])
        .filter((c: any) => containerNames.includes((c.name ?? "").replace(/^\//, "")))
        .map((c: any) => ({ id: c.id, name: (c.name ?? "").replace(/^\//, ""), state: c.state }));
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
    fetchVolumes();
    const interval = setInterval(() => fetchVolumes(), 30_000);
    return () => clearInterval(interval);
  }, [selectedNodeId, fetchVolumes, location.key]);

  const filteredVolumes = useMemo(() => {
    const sorted = [...volumes].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.driver.toLowerCase().includes(q)
    );
  }, [volumes, search]);

  const handleRemove = async (name: string) => {
    const ok = await confirm({
      title: "Remove Volume",
      description: `Remove volume "${name}"? Any data stored in this volume will be permanently lost.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.removeVolume(selectedNodeId!, name);
      toast.success("Volume removed");
      fetchVolumes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove volume");
    }
  };

  const handleCreate = async () => {
    if (!selectedNodeId || !createName.trim()) return;
    setCreating(true);
    try {
      const labels: Record<string, string> = {};
      for (const l of createLabels) {
        if (l.key.trim()) labels[l.key.trim()] = l.value;
      }
      await api.createVolume(selectedNodeId, {
        name: createName.trim(),
        driver: createDriver,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
      });
      toast.success("Volume created");
      closeCreate();
      fetchVolumes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create volume");
    } finally {
      setCreating(false);
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateName("");
    setCreateDriver("local");
    setCreateLabels([]);
  };

  const selectedNode = dockerNodes.find((n) => n.id === selectedNodeId);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Volumes</h1>
              {!isLoading && selectedNodeId && (
                <Badge variant="secondary">{volumes.length}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage Docker volumes across your nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <>
                <RefreshButton onClick={() => fetchVolumes()} disabled={isLoading} />
                {hasScope("docker:create") && (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Create Volume
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
              placeholder="Search volumes by name..."
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
          <EmptyState message="Select a node to view its volumes." />
        )}

        {selectedNodeId && (
          <>

            {filteredVolumes.length > 0 ? (
              <div className="border border-border rounded-lg bg-card">
                <div className="hidden md:grid md:grid-cols-[1fr_100px_1fr_80px_80px] gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Name</span>
                  <span>Driver</span>
                  <span>Mountpoint</span>
                  <span>Usage</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredVolumes.map((v) => {
                    const usedBy: string[] = (v as any).usedBy ?? (v as any).UsedBy ?? [];
                    const isUsed = usedBy.length > 0;
                    return (
                      <div
                        key={v.name}
                        className="flex flex-col md:grid md:grid-cols-[1fr_100px_1fr_80px_80px] gap-2 md:gap-4 p-4 items-start md:items-center"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                            <Database className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <p className="text-sm font-medium truncate">{v.name}</p>
                        </div>
                        <Badge variant="secondary" className="text-xs w-fit">
                          {v.driver}
                        </Badge>
                        <p className="text-xs font-mono text-muted-foreground truncate">
                          {v.mountpoint}
                        </p>
                        {isUsed ? (
                          <Badge
                            variant="success"
                            className="text-xs w-fit cursor-pointer hover:opacity-80"
                            onClick={() => showUsage(v.name, usedBy)}
                          >
                            In use
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs w-fit">
                            Unused
                          </Badge>
                        )}
                        <div className="flex items-center md:justify-end">
                          {hasScope("docker:delete") && !isUsed && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRemove(v.name)}
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
                Loading volumes...
              </div>
            ) : (
              <EmptyState
                message="No volumes found on this node."
                hasActiveFilters={search !== ""}
                onReset={() => setSearch("")}
                actionLabel={hasScope("docker:create") ? "Create a volume" : undefined}
                onAction={hasScope("docker:create") ? () => setCreateOpen(true) : undefined}
              />
            )}
          </>
        )}
      </div>

      {/* Create Volume Dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Volume</DialogTitle>
            <DialogDescription>
              Create a new volume on {selectedNode?.displayName || selectedNode?.hostname || "the selected node"}.
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
                placeholder="my-volume"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Driver</label>
              <Input
                className="mt-1"
                value={createDriver}
                onChange={(e) => setCreateDriver(e.target.value)}
                placeholder="local"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Labels</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateLabels((prev) => [...prev, { key: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {createLabels.map((label, idx) => (
                <div key={idx} className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder="key"
                    value={label.key}
                    onChange={(e) => {
                      const updated = [...createLabels];
                      updated[idx] = { ...updated[idx], key: e.target.value };
                      setCreateLabels(updated);
                    }}
                    className="w-36"
                  />
                  <span className="text-muted-foreground text-sm">=</span>
                  <Input
                    placeholder="value"
                    value={label.value}
                    onChange={(e) => {
                      const updated = [...createLabels];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      setCreateLabels(updated);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setCreateLabels((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
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
            <DialogTitle>Containers using this volume</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{usageVolume}</span>
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
              No containers found using this volume.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
