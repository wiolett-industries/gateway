import { Download, HardDrive, Search, Trash2 } from "lucide-react";
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
import type { DockerRegistry, Node } from "@/types";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatCreated(ts: number): string {
  const d = new Date(ts * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toLocaleDateString();
}

export function DockerImages() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const {
    images,
    selectedNodeId,
    isLoading,
    setSelectedNode,
    fetchImages,
  } = useDockerStore();

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterUsage, setFilterUsage] = useState("all");
  const [pruning, setPruning] = useState(false);

  // Usage dialog
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageImage, setUsageImage] = useState("");
  const [usageContainers, setUsageContainers] = useState<Array<{ id: string; name: string; state: string }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const showUsage = async (imageTag: string) => {
    if (!selectedNodeId) return;
    setUsageImage(imageTag);
    setUsageOpen(true);
    setUsageLoading(true);
    try {
      const containers = await api.listDockerContainers(selectedNodeId);
      const list = (Array.isArray(containers) ? containers : [])
        .map((c: any) => ({ id: c.id ?? c.Id ?? "", name: c.name ?? c.Name ?? "", state: c.state ?? c.State ?? "", image: c.image ?? c.Image ?? "" }))
        .filter((c: any) => c.image === imageTag || c.image.split(":")[0] === imageTag.split(":")[0]);
      setUsageContainers(list);
    } catch {
      setUsageContainers([]);
    } finally {
      setUsageLoading(false);
    }
  };

  // Pull dialog
  const [pullOpen, setPullOpen] = useState(false);
  const [pullRef, setPullRef] = useState("");
  const [pullRegistryId, setPullRegistryId] = useState<string>("");
  const [pulling, setPulling] = useState(false);
  const [registries, setRegistries] = useState<DockerRegistry[]>([]);

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

    api.listDockerRegistries().then(setRegistries).catch(() => {});
  }, []);

  const location = useLocation();
  useEffect(() => {
    if (!selectedNodeId) return;
    fetchImages();
    const interval = setInterval(() => fetchImages(), 30_000);
    return () => clearInterval(interval);
  }, [selectedNodeId, fetchImages, location.key]);

  const filteredImages = useMemo(() => {
    // Hide dangling images (<none>:<none>) — same as Docker Desktop
    let result = images.filter((img) => {
      const tags = (img as any).repoTags ?? (img as any).RepoTags ?? [];
      return tags.length > 0 && !tags.every((t: string) => t === "<none>:<none>");
    });
    if (filterUsage === "used") {
      result = result.filter((img) => ((img as any).containers ?? (img as any).Containers ?? 0) > 0);
    } else if (filterUsage === "unused") {
      result = result.filter((img) => ((img as any).containers ?? (img as any).Containers ?? 0) === 0);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((img) => {
        const tags = (img as any).repoTags ?? (img as any).RepoTags ?? [];
        const id = (img as any).id ?? (img as any).Id ?? "";
        return id.toLowerCase().includes(q) || tags.some((t: string) => t.toLowerCase().includes(q));
      });
    }
    return result;
  }, [images, search, filterUsage]);

  const handleRemove = async (imageId: string, tag: string) => {
    const ok = await confirm({
      title: "Remove Image",
      description: `Remove "${tag}"? This may affect running containers that use this image.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.removeImage(selectedNodeId!, imageId);
      toast.success("Image removed");
      fetchImages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove image");
    }
  };

  const handlePrune = async () => {
    const ok = await confirm({
      title: "Prune Unused Images",
      description: "Remove all dangling (unused) images from this node?",
      confirmLabel: "Prune",
    });
    if (!ok) return;
    setPruning(true);
    try {
      const result = await api.pruneImages(selectedNodeId!);
      const freed = (result as Record<string, unknown>).spaceReclaimed;
      toast.success(
        freed
          ? `Pruned images, freed ${formatSize(Number(freed))}`
          : "Pruned unused images"
      );
      fetchImages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prune failed");
    } finally {
      setPruning(false);
    }
  };

  const handlePull = async () => {
    if (!selectedNodeId || !pullRef.trim()) return;
    setPulling(true);
    try {
      await api.pullImage(selectedNodeId, pullRef.trim(), pullRegistryId || undefined);
      toast.success(`Pulling "${pullRef.trim()}" started`);
      closePull();
      fetchImages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pull image");
    } finally {
      setPulling(false);
    }
  };

  const closePull = () => {
    setPullOpen(false);
    setPullRef("");
    setPullRegistryId("");
  };

  const selectedNode = dockerNodes.find((n) => n.id === selectedNodeId);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Images</h1>
              {!isLoading && selectedNodeId && (
                <Badge variant="secondary">{images.length}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage Docker images across your nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <>
                <RefreshButton onClick={() => fetchImages()} disabled={isLoading} />
                {hasScope("docker:images:delete") && (
                  <Button variant="outline" onClick={handlePrune} disabled={pruning}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {pruning ? "Pruning..." : "Prune Unused"}
                  </Button>
                )}
                {hasScope("docker:images:pull") && (
                  <Button onClick={() => setPullOpen(true)}>
                    <Download className="h-4 w-4 mr-1" />
                    Pull Image
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Inline: [Node selector] [Search input] [Usage filter] */}
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
              placeholder="Search images by name or tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterUsage} onValueChange={setFilterUsage}>
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue placeholder="Usage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All images</SelectItem>
              <SelectItem value="used">In use</SelectItem>
              <SelectItem value="unused">Unused</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!selectedNodeId && !nodesLoading && dockerNodes.length === 0 && (
          <EmptyState message="No Docker nodes registered. Add a Docker node from the Nodes page." />
        )}

        {!selectedNodeId && !nodesLoading && dockerNodes.length > 0 && (
          <EmptyState message="Select a node to view its images." />
        )}

        {selectedNodeId && (
          <>

            {filteredImages.length > 0 ? (
              <div className="border border-border rounded-lg bg-card">
                <div className="hidden md:grid md:grid-cols-[1fr_200px_80px_100px_140px_80px] gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Repository:Tag</span>
                  <span>Image ID</span>
                  <span>Usage</span>
                  <span>Size</span>
                  <span>Created</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredImages.map((img) => {
                    const tags = (img as any).repoTags ?? (img as any).RepoTags ?? [];
                    const tag = tags.length > 0 ? tags[0] : "<none>:<none>";
                    const id = (img as any).id ?? (img as any).Id ?? "";
                    const size = (img as any).size ?? (img as any).Size ?? 0;
                    const created = (img as any).created ?? (img as any).Created ?? 0;
                    const containerCount = (img as any).containers ?? (img as any).Containers ?? 0;
                    const isUsed = containerCount > 0;
                    return (
                      <div
                        key={id}
                        className="flex flex-col md:grid md:grid-cols-[1fr_200px_80px_100px_140px_80px] gap-2 md:gap-4 p-4 items-start md:items-center"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                            <HardDrive className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{tag}</p>
                            {tags.length > 1 && (
                              <p className="text-xs text-muted-foreground truncate">
                                +{tags.length - 1} more tag{tags.length > 2 ? "s" : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground truncate">
                          {id.replace("sha256:", "").slice(0, 12)}
                        </span>
                        {isUsed ? (
                          <Badge
                            variant="success"
                            className="text-xs w-fit cursor-pointer hover:opacity-80"
                            onClick={() => showUsage(tag)}
                          >
                            In use
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs w-fit">
                            Unused
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">{formatSize(size)}</span>
                        <span className="text-sm text-muted-foreground">{formatCreated(created)}</span>
                        <div className="flex items-center md:justify-end">
                          {hasScope("docker:images:delete") && !isUsed && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRemove(id, tag)}
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
                Loading images...
              </div>
            ) : (
              <EmptyState
                message="No images found on this node."
                hasActiveFilters={search !== ""}
                onReset={() => setSearch("")}
              />
            )}
          </>
        )}
      </div>

      {/* Pull Image Dialog */}
      <Dialog open={pullOpen} onOpenChange={closePull}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pull Image</DialogTitle>
            <DialogDescription>
              Pull a Docker image to {selectedNode?.displayName || selectedNode?.hostname || "the selected node"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Image Reference <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                value={pullRef}
                onChange={(e) => setPullRef(e.target.value)}
                placeholder="nginx:latest"
                onKeyDown={(e) => { if (e.key === "Enter") handlePull(); }}
              />
            </div>
            {registries.length > 0 && (
              <div>
                <label className="text-sm font-medium">
                  Registry <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Select value={pullRegistryId} onValueChange={setPullRegistryId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Docker Hub (default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Docker Hub (default)</SelectItem>
                    {registries.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.url})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePull}>Cancel</Button>
            <Button onClick={handlePull} disabled={pulling || !pullRef.trim()}>
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
                  <Badge variant={c.state === "running" ? "success" : "secondary"} className="text-xs shrink-0">
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
    </PageTransition>
  );
}
