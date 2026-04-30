import { Download, HardDrive, Trash2 } from "lucide-react";
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
import { formatBytes, formatCreated } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerRegistry, Node } from "@/types";
import { isNodeIncompatible } from "@/types";

export function DockerImages({
  embedded,
  onPullRef,
  onRefreshRef,
  fixedNodeId,
}: {
  embedded?: boolean;
  onPullRef?: (fn: () => void) => void;
  onRefreshRef?: (fn: () => void) => void;
  fixedNodeId?: string;
} = {}) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const { images, selectedNodeId, setSelectedNode, fetchImages } = useDockerStore();
  const isLoading = useDockerStore((s) => s.loading.images);
  const storeDockerNodes = useDockerStore((s) => s.dockerNodes);
  const dockerNodesLoaded = useDockerStore((s) => s.dockerNodesLoaded);
  const visibleNodeId = fixedNodeId ?? selectedNodeId;
  const canFetchData = !!visibleNodeId || dockerNodesLoaded;

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filterUsage, setFilterUsage] = useState("all");
  const [pruning, setPruning] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageImage, setUsageImage] = useState("");
  const [usageContainers, setUsageContainers] = useState<
    Array<{ id: string; name: string; state: string }>
  >([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = useCallback(
    async (imageTag: string, nodeId?: string) => {
      const nid = nodeId || selectedNodeId;
      if (!nid) return;
      setUsageImage(imageTag);
      setUsageOpen(true);
      setUsageLoading(true);
      try {
        const containers = await api.listDockerContainers(nid);
        const list = (Array.isArray(containers) ? containers : [])
          .map((c: any) => ({
            id: c.id ?? c.Id ?? "",
            name: c.name ?? c.Name ?? "",
            state: c.state ?? c.State ?? "",
            image: c.image ?? c.Image ?? "",
          }))
          .filter(
            (c: any) => c.image === imageTag || c.image.split(":")[0] === imageTag.split(":")[0]
          );
        setUsageContainers(list);
      } catch {
        setUsageContainers([]);
      } finally {
        setUsageLoading(false);
      }
    },
    [selectedNodeId]
  );

  // Pull dialog
  const [pullOpen, setPullOpen] = useState(false);
  const [pullNodeId, setPullNodeId] = useState<string>("");
  const openPull = useCallback(() => {
    setPullNodeId(selectedNodeId || "");
    setPullOpen(true);
  }, [selectedNodeId]);
  useEffect(() => {
    onPullRef?.(() => openPull());
  }, [onPullRef, openPull]);
  useEffect(() => {
    onRefreshRef?.(() => void fetchImages(undefined, search));
  }, [fetchImages, onRefreshRef, search]);
  const [pullRef, setPullRef] = useState("");
  const [pullRegistryId, setPullRegistryId] = useState<string>("");
  const [pulling, setPulling] = useState(false);
  const [registries, setRegistries] = useState<DockerRegistry[]>([]);

  const loadImagePageState = useCallback(async () => {
    try {
      const regs = await api.listDockerRegistries();
      setRegistries(regs);
    } catch {}

    if (embedded && !fixedNodeId) {
      setNodesLoaded(dockerNodesLoaded);
      return;
    }
    if (fixedNodeId) {
      setSelectedNode(fixedNodeId);
      setNodesLoaded(true);
      return;
    }

    try {
      const r = await api.listNodes({ type: "docker", limit: 100 });
      const onlineNodes = r.data.filter(
        (n) => n.status === "online" && n.isConnected && !isNodeIncompatible(n)
      );
      setDockerNodes(onlineNodes);
      useDockerStore.getState().setDockerNodes(onlineNodes);
      setNodesLoaded(true);
    } catch {
      toast.error("Failed to load Docker nodes");
    }
  }, [dockerNodesLoaded, embedded, fixedNodeId, setSelectedNode]);

  useEffect(() => {
    void loadImagePageState();
  }, [loadImagePageState]);

  useEffect(() => {
    if (!canFetchData) return;
    fetchImages(fixedNodeId, search);
    const interval = setInterval(() => fetchImages(fixedNodeId, search), 30_000);
    return () => clearInterval(interval);
  }, [canFetchData, fetchImages, fixedNodeId, search]);

  useRealtime("docker.image.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (visibleNodeId && ev?.nodeId && ev.nodeId !== visibleNodeId) return;
    fetchImages(fixedNodeId, search);
  });

  const filteredImages = useMemo(() => {
    // Hide dangling images (<none>:<none>) — same as Docker Desktop
    let result = images.filter((img) => {
      const tags = (img as any).repoTags ?? (img as any).RepoTags ?? [];
      return tags.length > 0 && !tags.every((t: string) => t === "<none>:<none>");
    });
    if (filterUsage === "used") {
      result = result.filter(
        (img) => ((img as any).containers ?? (img as any).Containers ?? 0) > 0
      );
    } else if (filterUsage === "unused") {
      result = result.filter(
        (img) => ((img as any).containers ?? (img as any).Containers ?? 0) === 0
      );
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((img) => {
        const tags = (img as any).repoTags ?? (img as any).RepoTags ?? [];
        const id = (img as any).id ?? (img as any).Id ?? "";
        return (
          id.toLowerCase().includes(q) || tags.some((t: string) => t.toLowerCase().includes(q))
        );
      });
    }
    return result;
  }, [images, search, filterUsage]);
  const truncatedListMeta = images.find((img) => img._listTruncated);

  const handleRemove = useCallback(
    async (imageId: string, tag: string, nodeId?: string) => {
      const nid = nodeId || selectedNodeId;
      if (!nid) return;
      const ok = await confirm({
        title: "Remove Image",
        description: `Remove "${tag}"? This may affect running containers that use this image.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
      try {
        await api.removeImage(nid, imageId);
        toast.success("Image removed");
        fetchImages(undefined, search);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove image");
      }
    },
    [fetchImages, selectedNodeId, search]
  );

  const handlePrune = useCallback(async () => {
    const ok = await confirm({
      title: "Prune Unused Images",
      description: "Remove all dangling (unused) images from this node?",
      confirmLabel: "Prune",
    });
    if (!ok) return;
    setPruning(true);
    try {
      if (!selectedNodeId) {
        toast.error("Select a node to prune images");
        return;
      }
      const result = await api.pruneImages(selectedNodeId);
      const freed = (result as Record<string, unknown>).spaceReclaimed;
      toast.success(
        freed ? `Pruned images, freed ${formatBytes(Number(freed))}` : "Pruned unused images"
      );
      fetchImages(undefined, search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prune failed");
    } finally {
      setPruning(false);
    }
  }, [fetchImages, selectedNodeId, search]);

  const closePull = useCallback(() => {
    setPullOpen(false);
    setPullRef("");
    setPullRegistryId("");
  }, []);

  const handlePull = useCallback(async () => {
    if (!pullNodeId || !pullRef.trim()) return;
    setPulling(true);
    try {
      await api.pullImage(pullNodeId, pullRef.trim(), pullRegistryId || undefined);
      toast.success(`Pulling "${pullRef.trim()}" — check Tasks tab for progress`);
      closePull();
      useDockerStore.getState().invalidate("tasks");
      // Poll images to detect when pull completes
      setTimeout(() => fetchImages(undefined, search), 5000);
      setTimeout(() => fetchImages(undefined, search), 15000);
      setTimeout(() => fetchImages(undefined, search), 30000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pull image");
    } finally {
      setPulling(false);
    }
  }, [closePull, fetchImages, pullNodeId, pullRef, pullRegistryId, search]);

  const allImageColumns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        key: "tag",
        header: "Repository:Tag",
        width: "minmax(0, 1.45fr)",
        render: (img: any) => {
          const tags = img.repoTags ?? img.RepoTags ?? [];
          const tag = tags.length > 0 ? tags[0] : "<none>:<none>";
          return (
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <TruncateStart text={tag} className="text-sm font-medium" />
                {tags.length > 1 && (
                  <p className="text-xs text-muted-foreground truncate">
                    +{tags.length - 1} more tag{tags.length > 2 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: "id",
        header: "Image ID",
        width: "9rem",
        render: (img: any) => {
          const id = img.id ?? img.Id ?? "";
          return (
            <span className="text-xs font-mono text-muted-foreground truncate">
              {id.replace("sha256:", "").slice(0, 12)}
            </span>
          );
        },
      },
      {
        key: "node",
        header: "Node",
        width: "minmax(0, 1.15fr)",
        render: (img: any) => (
          <div className="min-w-0">
            <Badge variant="secondary" className="max-w-full shrink-0 px-2.5 text-xs">
              <span className="truncate">{(img as any)._nodeName || "-"}</span>
            </Badge>
          </div>
        ),
      },
      {
        key: "usage",
        header: "Usage",
        width: "6.5rem",
        render: (img: any) => {
          const tags = img.repoTags ?? img.RepoTags ?? [];
          const tag = tags.length > 0 ? tags[0] : "<none>:<none>";
          const containerCount = img.containers ?? img.Containers ?? 0;
          const isUsed = containerCount > 0;
          return isUsed ? (
            <Badge
              variant="success"
              className="text-xs w-fit cursor-pointer hover:opacity-80"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                showUsage(tag, (img as any)._nodeId);
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
        key: "size",
        header: "Size",
        width: "7rem",
        render: (img: any) => {
          const size = img.size ?? img.Size ?? 0;
          return <span className="text-sm text-muted-foreground">{formatBytes(size)}</span>;
        },
      },
      {
        key: "created",
        header: "Created",
        width: "8rem",
        align: "right" as const,
        render: (img: any) => {
          const created = img.created ?? img.Created ?? 0;
          return <span className="text-sm text-muted-foreground">{formatCreated(created)}</span>;
        },
      },
      {
        key: "actions",
        header: "Actions",
        width: "5.75rem",
        align: "right" as const,
        render: (img: any) => {
          const tags = img.repoTags ?? img.RepoTags ?? [];
          const tag = tags.length > 0 ? tags[0] : "<none>:<none>";
          const id = img.id ?? img.Id ?? "";
          const containerCount = img.containers ?? img.Containers ?? 0;
          const isUsed = containerCount > 0;
          return (
            <div
              className="flex items-center justify-end pr-1"
              onClick={(e) => e.stopPropagation()}
            >
              {hasScope("docker:images:delete") && !isUsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleRemove(id, tag, img._nodeId)}
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
  const imageColumns = allImageColumns.filter((c) => {
    if (fixedNodeId && c.key === "node") return false;
    if (!hasScope("docker:images:delete") && c.key === "actions") return false;
    return true;
  });

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Images</h1>
              {!isLoading && visibleNodeId && <Badge variant="secondary">{images.length}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">Manage Docker images across your nodes</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <>
                <RefreshButton
                  onClick={() => fetchImages(undefined, search)}
                  disabled={isLoading}
                />
                {hasScope("docker:images:delete") && (
                  <Button variant="outline" onClick={handlePrune} disabled={pruning}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {pruning ? "Pruning..." : "Prune Unused"}
                  </Button>
                )}
                {hasScope("docker:images:pull") && (
                  <Button onClick={() => openPull()}>
                    <Download className="h-4 w-4 mr-1" />
                    Pull Image
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
        placeholder="Search images by repository or tag..."
        hasActiveFilters={search !== "" || filterUsage !== "all" || !!selectedNodeId}
        onReset={() => {
          setSearch("");
          setFilterUsage("all");
          setSelectedNode(null);
        }}
        filters={
          <div className="flex items-center gap-3">
            <Select
              value={selectedNodeId ?? "__all__"}
              onValueChange={(v) => setSelectedNode(v === "__all__" ? null : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All nodes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All nodes</SelectItem>
                {(embedded ? storeDockerNodes : dockerNodes).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.displayName || n.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterUsage} onValueChange={setFilterUsage}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Usage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All images</SelectItem>
                <SelectItem value="used">In use</SelectItem>
                <SelectItem value="unused">Unused</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {truncatedListMeta && (
        <div className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Showing first {truncatedListMeta._listLimit ?? images.length} of{" "}
          {truncatedListMeta._listTotal ?? "many"} images. Narrow the node or search filters for
          more specific data.
        </div>
      )}

      {filteredImages.length > 0 ? (
        <DataTable
          columns={imageColumns}
          data={filteredImages}
          keyFn={(img: any) => {
            const tags = img.repoTags ?? img.RepoTags ?? [];
            return `${img._nodeId ?? selectedNodeId ?? "node"}:${img.id ?? img.Id ?? ""}:${tags.join("|")}`;
          }}
          emptyMessage="No images found."
        />
      ) : isLoading || (!visibleNodeId && !nodesLoaded) ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading images...</p>
          </div>
        </div>
      ) : (
        <EmptyState
          message="No images found."
          hasActiveFilters={search !== ""}
          onReset={() => setSearch("")}
        />
      )}

      {/* Pull Image Dialog */}
      <Dialog open={pullOpen} onOpenChange={closePull}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pull Image</DialogTitle>
            <DialogDescription>Pull a Docker image from a registry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Node */}
            <div>
              <label className="text-sm font-medium">
                Node <span className="text-destructive">*</span>
              </label>
              <Select
                value={pullNodeId}
                onValueChange={(v) => {
                  setPullNodeId(v);
                  setPullRegistryId("");
                }}
              >
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

            {/* Registry */}
            <div>
              <label className="text-sm font-medium">Registry</label>
              <Select
                value={pullRegistryId || "__default__"}
                onValueChange={(v) => setPullRegistryId(v === "__default__" ? "" : v)}
                disabled={!pullNodeId}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={pullNodeId ? "Docker Hub" : "Select a node first"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Docker Hub</SelectItem>
                  {registries
                    .filter((r) => r.scope === "global" || r.nodeId === pullNodeId)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.url}){r.scope === "node" ? " · this node" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Image */}
            <div>
              <label className="text-sm font-medium">
                Image <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                value={pullRef}
                onChange={(e) => setPullRef(e.target.value)}
                placeholder="nginx:latest"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePull();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePull}>
              Cancel
            </Button>
            <Button onClick={handlePull} disabled={pulling || !pullRef.trim() || !pullNodeId}>
              {pulling ? "Pulling..." : "Pull"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage Dialog */}
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Containers using this image</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{usageImage}</span>
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
                    <p className="text-sm font-medium truncate">{c.name.replace(/^\//, "")}</p>
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
              No containers found using this image.
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
