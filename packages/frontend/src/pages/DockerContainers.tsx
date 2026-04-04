import { Box, CornerDownRight, Layers, Play, Plus, RefreshCw, ScrollText, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { ContainerCreateConfig, DockerContainer, Node } from "@/types";

const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  running: "success",
  exited: "secondary",
  stopped: "secondary",
  paused: "warning",
  dead: "destructive",
  restarting: "warning",
  stopping: "warning",
  recreating: "warning",
  updating: "warning",
  killing: "warning",
  created: "secondary",
};

function formatCreated(ts: number): string {
  const d = new Date(ts * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toLocaleDateString();
}

function containerDisplayName(name: string): string {
  // Docker container names often start with "/"
  return name.startsWith("/") ? name.slice(1) : name;
}


export function DockerContainers({ embedded, onDeployRef, fixedNodeId }: { embedded?: boolean; onDeployRef?: (fn: () => void) => void; fixedNodeId?: string } = {}) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const containers = useDockerStore((s) => s.containers);
  const selectedNodeId = useDockerStore((s) => s.selectedNodeId);
  const filters = useDockerStore((s) => s.filters);
  const isLoading = useDockerStore((s) => s.isLoading);
  const setSelectedNode = useDockerStore((s) => s.setSelectedNode);
  const setFilters = useDockerStore((s) => s.setFilters);
  const resetFilters = useDockerStore((s) => s.resetFilters);
  const fetchContainers = useDockerStore((s) => s.fetchContainers);
  const forceFetchContainers = useDockerStore((s) => s.forceFetchContainers);

  // Fast-poll while any container has a transition state (same pattern as container detail page)
  const hasTransitions = containers.some((c) => (c as any)._transition);
  const transitionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (hasTransitions) {
      if (!transitionPollRef.current) {
        transitionPollRef.current = setInterval(() => forceFetchContainers(), 2000);
      }
    } else {
      if (transitionPollRef.current) {
        clearInterval(transitionPollRef.current);
        transitionPollRef.current = null;
      }
    }
    return () => {
      if (transitionPollRef.current) {
        clearInterval(transitionPollRef.current);
        transitionPollRef.current = null;
      }
    };
  }, [hasTransitions, forceFetchContainers]);

  const [searchInput, setSearchInput] = useState(filters.search);
  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);

  // Action loading states keyed by container id
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Deploy dialog state
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployNodeId, setDeployNodeId] = useState<string>("");
  const [deployImage, setDeployImage] = useState("");
  const [deployLocalImages, setDeployLocalImages] = useState<string[]>([]);
  const [deployPullableImages, setDeployPullableImages] = useState<string[]>([]);
  const [deployName, setDeployName] = useState("");
  const [deployRestart, setDeployRestart] = useState("no");
  const [deploying, setDeploying] = useState(false);
  const openDeploy = () => { setDeployNodeId(selectedNodeId || ""); setDeployImage(""); setDeployOpen(true); };

  // Expose deploy dialog opener to parent
  useEffect(() => {
    onDeployRef?.(openDeploy);
  }, [onDeployRef]);

  // Fetch local images + pullable images from other nodes when deploy node changes
  useEffect(() => {
    if (!deployNodeId) { setDeployLocalImages([]); setDeployPullableImages([]); return; }

    const extractTags = (data: unknown): string[] => {
      const tags: string[] = [];
      for (const img of (Array.isArray(data) ? data : [])) {
        for (const t of ((img as any).repoTags ?? (img as any).RepoTags ?? [])) {
          if (t && t !== "<none>:<none>") tags.push(t);
        }
      }
      return tags;
    };

    // Fetch local images
    api.listDockerImages(deployNodeId)
      .then((data) => setDeployLocalImages(extractTags(data).sort()))
      .catch(() => setDeployLocalImages([]));

    // Fetch images from other nodes (pullable) — only if user can pull
    if (!hasScope("docker:images:pull")) { setDeployPullableImages([]); return; }
    const otherNodes = useDockerStore.getState().dockerNodes.filter((n) => n.id !== deployNodeId);
    if (otherNodes.length > 0) {
      Promise.all(otherNodes.map((n) => api.listDockerImages(n.id).then(extractTags).catch(() => [] as string[])))
        .then((results) => {
          const localSet = new Set<string>();
          api.listDockerImages(deployNodeId).then((d) => {
            for (const t of extractTags(d)) localSet.add(t);
            const pullable = new Set<string>();
            for (const tags of results) {
              for (const t of tags) {
                if (!localSet.has(t)) pullable.add(t);
              }
            }
            setDeployPullableImages(Array.from(pullable).sort());
          }).catch(() => {});
        });
    } else {
      setDeployPullableImages([]);
    }
  }, [deployNodeId]);

  // When fixedNodeId is set (e.g. from node detail page), use it directly
  useEffect(() => {
    if (fixedNodeId) {
      setSelectedNode(fixedNodeId);
    }
  }, [fixedNodeId, setSelectedNode]);

  // Fetch docker nodes on mount — intentionally runs once
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    if (embedded) { setNodesLoading(false); return; }
    setNodesLoading(true);
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) => {
        setDockerNodes(r.data);
        // Also set in store for multi-node fetching
        useDockerStore.getState().setDockerNodes(r.data);
      })
      .catch(() => {
        toast.error("Failed to load Docker nodes");
      })
      .finally(() => setNodesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch containers and auto-refresh every 30s
  useEffect(() => {
    if (embedded) return; // Parent handles fetch in embedded mode
    fetchContainers();
    const interval = setInterval(() => fetchContainers(), 30_000);
    return () => clearInterval(interval);
  }, [selectedNodeId, fetchContainers, embedded]);

  // Sync search input with store filter
  const handleSearch = useCallback(() => {
    setFilters({ search: searchInput });
  }, [searchInput, setFilters]);

  // Filter containers based on status and search
  const filteredContainers = useMemo(() => {
    let result = containers;
    if (filters.status !== "all") {
      if (filters.status === "running") {
        result = result.filter((c) => c.state === "running");
      } else if (filters.status === "stopped") {
        result = result.filter((c) => c.state !== "running");
      }
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          containerDisplayName(c.name).toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      );
    }
    // Sort: compose groups together (alphabetically), then standalone
    result.sort((a, b) => {
      const pa = (a.labels?.["com.docker.compose.project"]) ?? "";
      const pb = (b.labels?.["com.docker.compose.project"]) ?? "";
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa !== pb) return pa.localeCompare(pb);
      // Within same compose project, sort by service name
      const sa = (a.labels?.["com.docker.compose.service"]) ?? a.name;
      const sb = (b.labels?.["com.docker.compose.service"]) ?? b.name;
      return sa.localeCompare(sb);
    });
    return result;
  }, [containers, filters]);

  // Compose group metrics
  const composeGroups = useMemo(() => {
    const groups = new Map<string, { total: number; running: number; nodeId: string }>();
    for (const c of filteredContainers) {
      const project = c.labels?.["com.docker.compose.project"];
      if (!project) continue;
      const g = groups.get(project) ?? { total: 0, running: 0, nodeId: (c as any)._nodeId || "" };
      g.total++;
      if (c.state === "running") g.running++;
      groups.set(project, g);
    }
    return groups;
  }, [filteredContainers]);

  const hasActiveFilters = filters.search !== "" || filters.status !== "all";

  // Container actions
  const doAction = async (containerId: string, action: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [containerId]: action }));
    try {
      await fn();
      toast.success(`Container ${action} successful`);
      // Force-fetch bypasses SWR cache; transition polling handles the rest
      forceFetchContainers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} container`);
    } finally {
      setActionLoading((prev) => {
        const copy = { ...prev };
        delete copy[containerId];
        return copy;
      });
    }
  };

  const nodeOf = (c: DockerContainer) => (c as any)._nodeId || selectedNodeId!;

  const handleStart = (c: DockerContainer) =>
    doAction(c.id, "start", () => api.startContainer(nodeOf(c), c.id));

  const handleStop = (c: DockerContainer) =>
    doAction(c.id, "stop", () => api.stopContainer(nodeOf(c), c.id));

  const handleRestart = (c: DockerContainer) =>
    doAction(c.id, "restart", () => api.restartContainer(nodeOf(c), c.id));

  // Deploy container
  const handleDeploy = async () => {
    if (!deployNodeId || !deployImage.trim()) return;
    setDeploying(true);
    try {
      // Auto-pull if image not available locally
      const isLocal = deployLocalImages.includes(deployImage.trim());
      if (!isLocal) {
        toast.info(`Pulling "${deployImage.trim()}"...`);
        await api.pullImage(deployNodeId, deployImage.trim());
      }
      const config: ContainerCreateConfig = {
        image: deployImage.trim(),
        restartPolicy: deployRestart,
      };
      if (deployName.trim()) config.name = deployName.trim();
      const result = await api.createContainer(deployNodeId, config);
      toast.success("Container deployed");
      closeDeploy();
      fetchContainers();
      const newId = (result as any)?.id ?? (result as any)?.Id;
      if (newId) navigate(`/docker/containers/${deployNodeId}/${newId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy container");
    } finally {
      setDeploying(false);
    }
  };

  const closeDeploy = () => {
    setDeployOpen(false);
    setDeployImage("");
    setDeployName("");
    setDeployRestart("no");
  };


  const allContainerColumns: DataTableColumn<DockerContainer>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        truncate: true,
        render: (c) => {
          const isCompose = !!c.labels?.["com.docker.compose.project"];
          return (
            <div className="flex items-center gap-3 min-w-0">
              {isCompose && <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                <Box className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {containerDisplayName(c.name)}
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {c.id.slice(0, 12)}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        key: "image",
        header: "Image",
        truncate: true,
        render: (c) => (
          <span className="text-muted-foreground">{c.image}</span>
        ),
      },
      {
        key: "node",
        header: "Node",
        width: "140px",
        render: (c) => <Badge variant="secondary" className="text-xs w-fit">{(c as any)._nodeName || "-"}</Badge>,
      },
      {
        key: "status",
        header: "Status",
        width: "131px",
        render: (c) => (
          <Badge
            variant={STATUS_BADGE[(c as any)._transition ?? c.state] ?? "secondary"}
            className="text-xs w-fit"
          >
            {(c as any)._transition ?? c.state}
          </Badge>
        ),
      },
      {
        key: "created",
        header: "Created",
        width: "120px",
        render: (c) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {formatCreated(c.created)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        width: "100px",
        align: "right" as const,
        render: (c) => {
          const loadingAction = actionLoading[c.id];
          return (
            <div
              className="flex items-center gap-0.5 justify-end"
              onClick={(e) => e.stopPropagation()}
            >
              {c.state === "running" ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!!loadingAction || !!(c as any)._transition}
                    onClick={() => handleStop(c)}
                    title="Stop"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!!loadingAction || !!(c as any)._transition}
                    onClick={() => handleRestart(c)}
                    title="Restart"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!!loadingAction || !!(c as any)._transition}
                  onClick={() => handleStart(c)}
                  title="Start"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [actionLoading, handleStop, handleRestart, handleStart]
  );
  const containerColumns = fixedNodeId ? allContainerColumns.filter((c) => c.key !== "node") : allContainerColumns;

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">Docker Containers</h1>
                {!isLoading && selectedNodeId && (
                  <Badge variant="secondary">{containers.length}</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Manage containers across your Docker nodes
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedNodeId && (
                <RefreshButton onClick={() => fetchContainers()} disabled={isLoading} />
              )}
              {hasScope("docker:containers:create") && selectedNodeId && (
                <Button onClick={() => openDeploy()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Deploy Container
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Filters */}
      <SearchFilterBar
        search={searchInput}
        onSearchChange={(v) => { setSearchInput(v); setFilters({ search: v }); }}
        onSearchSubmit={handleSearch}
        placeholder="Search containers by name or image..."
        hasActiveFilters={searchInput !== "" || filters.status !== "all" || !!selectedNodeId}
        onReset={() => { setSearchInput(""); resetFilters(); setSelectedNode(null); }}
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
                {(embedded ? useDockerStore.getState().dockerNodes : dockerNodes).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.displayName || n.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters({ status: v })}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

        {!nodesLoading && !embedded && dockerNodes.length === 0 && useDockerStore.getState().dockerNodes.length === 0 && (
          <EmptyState message="No Docker nodes registered. Add a Docker node from the Nodes page to get started." />
        )}

        {(selectedNodeId || useDockerStore.getState().dockerNodes.length > 0 || embedded) && (
          <>

            {/* Container list */}
            {filteredContainers.length > 0 ? (
              <DataTable
                columns={containerColumns}
                data={filteredContainers}
                keyFn={(c) => c.id}
                onRowClick={(c) => navigate(`/docker/containers/${(c as any)._nodeId || selectedNodeId}/${c.id}`)}
                emptyMessage="No containers found."
                groupBy={(c) => {
                  const project = c.labels?.["com.docker.compose.project"];
                  if (!project) return null;
                  const g = composeGroups.get(project);
                  return {
                    key: project,
                    label: (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium uppercase tracking-wider">{project}</span>
                        </div>
                        {g && (
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{g.running}/{g.total} running</span>
                            <ScrollText className="h-3.5 w-3.5 cursor-pointer hover:text-foreground" />
                          </div>
                        )}
                      </div>
                    ),
                  };
                }}
                onGroupClick={(group) => {
                  // Open compose logs popout
                  const g = composeGroups.get(group.key);
                  if (g?.nodeId) {
                    window.open(
                      `/docker/compose-logs/${g.nodeId}/${encodeURIComponent(group.key)}`,
                      `compose-logs-${group.key}`,
                      "width=900,height=600"
                    );
                  }
                }}
              />
            ) : isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                Loading containers...
              </div>
            ) : (
              <EmptyState
                message="No containers found on this node."
                hasActiveFilters={hasActiveFilters}
                onReset={() => {
                  setSearchInput("");
                  resetFilters();
                }}
                actionLabel={hasScope("docker:containers:create") ? "Deploy a container" : undefined}
                onAction={hasScope("docker:containers:create") ? () => openDeploy() : undefined}
              />
            )}
          </>
        )}

      {/* Deploy Container Dialog */}
      <Dialog open={deployOpen} onOpenChange={closeDeploy}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deploy Container</DialogTitle>
            <DialogDescription>
              Create and start a new container.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Node */}
            <div>
              <label className="text-sm font-medium">
                Node <span className="text-destructive">*</span>
              </label>
              <Select value={deployNodeId} onValueChange={(v) => { setDeployNodeId(v); setDeployImage(""); }}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a node" />
                </SelectTrigger>
                <SelectContent>
                  {(useDockerStore.getState().dockerNodes.length > 0 ? useDockerStore.getState().dockerNodes : dockerNodes).map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.displayName || n.hostname}
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
              <Select value={deployImage} onValueChange={setDeployImage} disabled={!deployNodeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={!deployNodeId ? "Select a node first" : "Select an image"} />
                </SelectTrigger>
                <SelectContent>
                  {deployLocalImages.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>On this node</SelectLabel>
                      {deployLocalImages.map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {deployPullableImages.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Available to pull</SelectLabel>
                      {deployPullableImages.map((tag) => (
                        <SelectItem key={`pull:${tag}`} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {deployLocalImages.length === 0 && deployPullableImages.length === 0 && (
                    <SelectItem value="__none__" disabled>No images available</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {deployImage && !deployLocalImages.includes(deployImage) && deployNodeId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Will be pulled to this node on deploy
                </p>
              )}
            </div>

            {/* Container name */}
            <div>
              <label className="text-sm font-medium">
                Container Name <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                className="mt-1"
                value={deployName}
                onChange={(e) => setDeployName(e.target.value)}
                placeholder="my-container"
              />
            </div>

            {/* Restart policy */}
            <div>
              <label className="text-sm font-medium">Restart Policy</label>
              <Select value={deployRestart} onValueChange={setDeployRestart}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="always">Always</SelectItem>
                  <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                  <SelectItem value="on-failure">On Failure</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDeploy}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying || !deployImage.trim() || !deployNodeId}>
              {deploying ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
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
