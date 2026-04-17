import { Database, Minus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
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
import type { DockerVolume, Node } from "@/types";
import { isNodeIncompatible } from "@/types";

interface LabelEntry {
  key: string;
  value: string;
}

export function DockerVolumes({
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
  const { volumes, selectedNodeId, isLoading, setSelectedNode, fetchVolumes } = useDockerStore();
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
  const [createDriver, setCreateDriver] = useState("local");
  const [createLabels, setCreateLabels] = useState<LabelEntry[]>([]);
  const [creating, setCreating] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageVolume, setUsageVolume] = useState("");
  const [usageContainers, setUsageContainers] = useState<
    Array<{ id: string; name: string; state: string }>
  >([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = useCallback(
    async (volumeName: string, containerNames: string[], nodeId?: string) => {
      const nid = nodeId || selectedNodeId;
      if (!nid) return;
      setUsageVolume(volumeName);
      setUsageOpen(true);
      setUsageLoading(true);
      try {
        const containers = await api.listDockerContainers(nid);
        const matched = (containers ?? [])
          .filter((c: any) => containerNames.includes((c.name ?? "").replace(/^\//, "")))
          .map((c: any) => ({ id: c.id, name: (c.name ?? "").replace(/^\//, ""), state: c.state }));
        setUsageContainers(matched);
      } catch {
        setUsageContainers([]);
      }
      setUsageLoading(false);
    },
    [selectedNodeId]
  );

  const loadVolumeNodes = useCallback(async () => {
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
    void loadVolumeNodes();
  }, [loadVolumeNodes]);

  useEffect(() => {
    if (!visibleNodeId) return;
    fetchVolumes(fixedNodeId);
    const interval = setInterval(() => fetchVolumes(fixedNodeId), 30_000);
    return () => clearInterval(interval);
  }, [fetchVolumes, fixedNodeId, visibleNodeId]);

  useRealtime("docker.volume.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (visibleNodeId && ev?.nodeId && ev.nodeId !== visibleNodeId) return;
    fetchVolumes(fixedNodeId);
  });

  const filteredVolumes = useMemo(() => {
    const sorted = [...volumes].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (v) => v.name.toLowerCase().includes(q) || v.driver.toLowerCase().includes(q)
    );
  }, [volumes, search]);

  const handleRemove = useCallback(
    async (name: string, nodeId?: string) => {
      const nid = nodeId || selectedNodeId;
      if (!nid) return;
      const ok = await confirm({
        title: "Remove Volume",
        description: `Remove volume "${name}"? Any data stored in this volume will be permanently lost.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
      try {
        await api.removeVolume(nid, name);
        toast.success("Volume removed");
        fetchVolumes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove volume");
      }
    },
    [fetchVolumes, selectedNodeId]
  );

  const handleCreate = async () => {
    if (!createNodeId || !createName.trim()) return;
    setCreating(true);
    try {
      const labels: Record<string, string> = {};
      for (const l of createLabels) {
        if (l.key.trim()) labels[l.key.trim()] = l.value;
      }
      await api.createVolume(createNodeId, {
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

  const allVolumeColumns: DataTableColumn<DockerVolume>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        width: "minmax(0, 1.35fr)",
        render: (v) => (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
              <Database className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <TruncateStart text={v.name} className="text-sm font-medium" />
            </div>
          </div>
        ),
      },
      {
        key: "driver",
        header: "Driver",
        width: "7rem",
        render: (v) => <span className="text-sm text-muted-foreground">{v.driver}</span>,
      },
      {
        key: "node",
        header: "Node",
        width: "minmax(0, 1.15fr)",
        render: (v) => (
          <div className="min-w-0">
            <Badge variant="secondary" className="max-w-full shrink-0 px-2.5 text-xs">
              <span className="truncate">{(v as any)._nodeName || "-"}</span>
            </Badge>
          </div>
        ),
      },
      {
        key: "usage",
        header: "Usage",
        width: "6.5rem",
        render: (v) => {
          const usedBy: string[] = (v as any).usedBy ?? (v as any).UsedBy ?? [];
          const isUsed = usedBy.length > 0;
          return isUsed ? (
            <Badge
              variant="success"
              className="text-xs w-fit cursor-pointer hover:opacity-80"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                showUsage(v.name, usedBy, (v as any)._nodeId);
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
        key: "created",
        header: "Created",
        width: "8rem",
        align: "right" as const,
        render: (v) => (
          <span className="text-sm text-muted-foreground">
            {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "-"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        width: "5.75rem",
        align: "right" as const,
        render: (v) => {
          const usedBy: string[] = (v as any).usedBy ?? (v as any).UsedBy ?? [];
          const isUsed = usedBy.length > 0;
          return (
            <div
              className="flex items-center justify-end pr-1"
              onClick={(e) => e.stopPropagation()}
            >
              {hasScope("docker:volumes:delete") && !isUsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleRemove(v.name, (v as any)._nodeId)}
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
    [hasScope, handleRemove, showUsage]
  );
  const volumeColumns = fixedNodeId
    ? allVolumeColumns.filter((c) => c.key !== "node")
    : allVolumeColumns;

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Volumes</h1>
              {!isLoading && selectedNodeId && <Badge variant="secondary">{volumes.length}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">Manage Docker volumes across your nodes</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <>
                <RefreshButton onClick={() => fetchVolumes()} disabled={isLoading} />
                {hasScope("docker:volumes:create") && (
                  <Button onClick={() => openCreate()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Create Volume
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
        placeholder="Search volumes by name..."
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

      {filteredVolumes.length > 0 ? (
        <DataTable
          columns={volumeColumns}
          data={filteredVolumes}
          keyFn={(v) => v.name}
          emptyMessage="No volumes found."
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading volumes...</p>
          </div>
        </div>
      ) : (
        <EmptyState
          message="No volumes found."
          hasActiveFilters={search !== ""}
          onReset={() => setSearch("")}
          actionLabel={hasScope("docker:volumes:create") ? "Create a volume" : undefined}
          onAction={hasScope("docker:volumes:create") ? () => openCreate() : undefined}
        />
      )}

      {/* Create Volume Dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Volume</DialogTitle>
            <DialogDescription>
              Create a new volume on{" "}
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
              No containers found using this volume.
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
