import {
  Box,
  CornerDownRight,
  Layers,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TruncateStart } from "@/components/ui/truncate-start";
import { useRealtime } from "@/hooks/use-realtime";
import { formatCreated } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerContainer, Node } from "@/types";
import { isNodeIncompatible } from "@/types";
import { DockerDeployDialog } from "./DockerDeployDialog";
import { containerDisplayName, STATUS_BADGE } from "./docker-detail/helpers";

export function DockerContainers({
  embedded,
  onDeployRef,
  fixedNodeId,
}: {
  embedded?: boolean;
  onDeployRef?: (fn: () => void) => void;
  fixedNodeId?: string;
} = {}) {
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
  const visibleNodeId = fixedNodeId ?? selectedNodeId;

  // Realtime: refetch the list whenever any container on the visible node(s) changes.
  useRealtime("docker.container.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (!ev) return;
    // If we're scoped to a single node, ignore events from other nodes
    if (visibleNodeId && ev.nodeId && ev.nodeId !== visibleNodeId) return;
    forceFetchContainers(fixedNodeId);
  });
  useRealtime("docker.task.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (!ev) return;
    if (visibleNodeId && ev.nodeId && ev.nodeId !== visibleNodeId) return;
    forceFetchContainers(fixedNodeId);
  });

  const [searchInput, setSearchInput] = useState(filters.search);
  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);

  // Action loading states keyed by container id
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Deploy dialog state
  const [deployOpen, setDeployOpen] = useState(false);
  const openDeploy = useCallback(() => setDeployOpen(true), []);

  // Expose deploy dialog opener to parent
  useEffect(() => {
    onDeployRef?.(openDeploy);
  }, [onDeployRef, openDeploy]);

  // When fixedNodeId is set (e.g. from node detail page), use it directly
  useEffect(() => {
    if (fixedNodeId) {
      setSelectedNode(fixedNodeId);
    }
  }, [fixedNodeId, setSelectedNode]);

  const loadDockerNodes = useCallback(async () => {
    setNodesLoading(true);
    try {
      const r = await api.listNodes({ type: "docker", limit: 100 });
      const compatible = r.data.filter((n) => n.status === "online" && !isNodeIncompatible(n));
      setDockerNodes(compatible);
      useDockerStore.getState().setDockerNodes(compatible);
    } catch {
      toast.error("Failed to load Docker nodes");
    } finally {
      setNodesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (embedded) {
      setNodesLoading(false);
      return;
    }
    void loadDockerNodes();
  }, [embedded, loadDockerNodes]);

  // Fetch containers and auto-refresh every 30s
  useEffect(() => {
    fetchContainers(fixedNodeId);
    const interval = setInterval(() => fetchContainers(fixedNodeId), 30_000);
    return () => clearInterval(interval);
  }, [fetchContainers, fixedNodeId]);

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
      const pa = a.labels?.["com.docker.compose.project"] ?? "";
      const pb = b.labels?.["com.docker.compose.project"] ?? "";
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa !== pb) return pa.localeCompare(pb);
      // Within same compose project, sort by service name
      const sa = a.labels?.["com.docker.compose.service"] ?? a.name;
      const sb = b.labels?.["com.docker.compose.service"] ?? b.name;
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
  const doAction = useCallback(
    async (containerId: string, action: string, fn: () => Promise<void>) => {
      setActionLoading((prev) => ({ ...prev, [containerId]: action }));
      try {
        await fn();
        toast.success(`Container ${action} successful`);
        // Force-fetch bypasses SWR cache; transition polling handles the rest
        forceFetchContainers(fixedNodeId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action} container`);
      } finally {
        setActionLoading((prev) => {
          const copy = { ...prev };
          delete copy[containerId];
          return copy;
        });
      }
    },
    [fixedNodeId, forceFetchContainers]
  );

  const nodeOf = useCallback(
    (c: DockerContainer) => (c as any)._nodeId || selectedNodeId!,
    [selectedNodeId]
  );

  const handleStart = useCallback(
    (c: DockerContainer) => doAction(c.id, "start", () => api.startContainer(nodeOf(c), c.id)),
    [doAction, nodeOf]
  );

  const handleStop = useCallback(
    (c: DockerContainer) => doAction(c.id, "stop", () => api.stopContainer(nodeOf(c), c.id)),
    [doAction, nodeOf]
  );

  const handleRestart = useCallback(
    (c: DockerContainer) => doAction(c.id, "restart", () => api.restartContainer(nodeOf(c), c.id)),
    [doAction, nodeOf]
  );

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
              {isCompose && (
                <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
                <Box className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <TruncateStart
                  text={containerDisplayName(c.name)}
                  className="text-sm font-medium"
                />
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
        render: (c) => <TruncateStart text={c.image} className="text-muted-foreground" />,
      },
      {
        key: "node",
        header: "Node",
        width: "minmax(210px, 0.8fr)",
        render: (c) => (
          <div className="min-w-0 flex">
            <Badge
              variant="secondary"
              className="text-xs max-w-full overflow-hidden text-ellipsis whitespace-nowrap inline-flex"
            >
              {(c as any)._nodeName || "-"}
            </Badge>
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        width: "160px",
        render: (c) => (
          <div className="min-w-0 flex">
            <Badge
              variant={STATUS_BADGE[(c as any)._transition ?? c.state] ?? "secondary"}
              className="text-xs max-w-full overflow-hidden text-ellipsis whitespace-nowrap inline-flex"
            >
              {(c as any)._transition ?? c.state}
            </Badge>
          </div>
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
  const containerColumns = fixedNodeId
    ? allContainerColumns.filter((c) => c.key !== "node")
    : allContainerColumns;

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
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
              <Button onClick={openDeploy}>
                <Plus className="h-4 w-4 mr-1" />
                Deploy Container
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <SearchFilterBar
        search={searchInput}
        onSearchChange={(v) => {
          setSearchInput(v);
          setFilters({ search: v });
        }}
        onSearchSubmit={handleSearch}
        placeholder="Search containers by name or image..."
        hasActiveFilters={searchInput !== "" || filters.status !== "all" || !!selectedNodeId}
        onReset={() => {
          setSearchInput("");
          resetFilters();
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
                {(embedded ? useDockerStore.getState().dockerNodes : dockerNodes)
                  .filter((n) => !isNodeIncompatible(n))
                  .map((n) => (
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

      {!nodesLoading &&
        !embedded &&
        dockerNodes.length === 0 &&
        useDockerStore.getState().dockerNodes.length === 0 && (
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
              onRowClick={(c) =>
                navigate(`/docker/containers/${(c as any)._nodeId || selectedNodeId}/${c.id}`)
              }
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
                        <span className="text-xs font-medium uppercase tracking-wider">
                          {project}
                        </span>
                      </div>
                      {g && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            {g.running}/{g.total} running
                          </span>
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
      <DockerDeployDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        nodeId={selectedNodeId || undefined}
        dockerNodes={dockerNodes}
        onDeployed={() => fetchContainers()}
      />
    </>
  );

  if (embedded) return <div className="flex flex-col flex-1 min-h-0 space-y-4">{content}</div>;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">{content}</div>
    </PageTransition>
  );
}
