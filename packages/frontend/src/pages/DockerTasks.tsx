import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { api } from "@/services/api";
import { useDockerStore } from "@/stores/docker";
import type { DockerTask, Node } from "@/types";

const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  pending: "secondary",
  running: "default",
  succeeded: "success",
  failed: "destructive",
};

function formatDuration(start: string, end?: string): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, e - s);
  if (diff < 1000) return "<1s";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
  return `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

export function DockerTasks({ embedded }: { embedded?: boolean } = {}) {
  const { tasks, fetchTasks } = useDockerStore();

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterNode, setFilterNode] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedTask, setSelectedTask] = useState<DockerTask | null>(null);

  const loadTasks = useCallback(async () => {
    await fetchTasks();
    setIsLoading(false);
  }, [fetchTasks]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    loadTasks();
    api.listNodes({ type: "docker", limit: 100 }).then((r) => setDockerNodes(r.data)).catch(() => {});
  }, []);

  // Auto-refresh every 5s
  useEffect(() => {
    const interval = setInterval(() => fetchTasks(), 5_000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of dockerNodes) {
      map.set(n.id, n.displayName || n.hostname);
    }
    return map;
  }, [dockerNodes]);

  const taskTypes = useMemo(() => {
    const types = new Set(tasks.map((t) => t.type));
    return Array.from(types).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterNode !== "all") {
      result = result.filter((t) => t.nodeId === filterNode);
    }
    if (filterType !== "all") {
      result = result.filter((t) => t.type === filterType);
    }
    if (filterStatus !== "all") {
      result = result.filter((t) => t.status === filterStatus);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.type.toLowerCase().includes(q) ||
          (t.containerName ?? "").toLowerCase().includes(q) ||
          (t.error ?? "").toLowerCase().includes(q)
      );
    }
    // Sort by createdAt descending
    return [...result].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tasks, filterNode, filterType, filterStatus, search]);

  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset visible count when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filterNode, filterType, filterStatus, search]);

  const visibleTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTasks.length;

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredTasks.length));
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filteredTasks.length]);

  const taskColumns: DataTableColumn<DockerTask>[] = useMemo(() => [
    { key: "type", header: "Type", render: (t) => <span className="font-medium whitespace-nowrap">{t.type}</span> },
    { key: "container", header: "Container", render: (t) => <span className="text-muted-foreground truncate">{t.containerName || t.containerId?.slice(0, 12) || "-"}</span>, className: "max-w-[200px]" },
    { key: "node", header: "Node", render: (t) => <span className="text-muted-foreground truncate">{nodeMap.get(t.nodeId) ?? t.nodeId.slice(0, 8)}</span>, className: "max-w-[200px]" },
    { key: "status", header: "Status", render: (t) => <Badge variant={STATUS_BADGE[t.status] ?? "secondary"} className={`text-xs ${t.status === "running" ? "animate-pulse" : ""}`}>{t.status}</Badge> },
    { key: "started", header: "Started", align: "right", render: (t) => <span className="text-muted-foreground whitespace-nowrap">{formatTime(t.createdAt)}</span> },
    { key: "duration", header: "Duration", align: "right", render: (t) => <span className="text-muted-foreground whitespace-nowrap">{formatDuration(t.createdAt, t.completedAt)}</span> },
  ], [nodeMap]);

  const hasActiveFilters =
    search !== "" || filterNode !== "all" || filterType !== "all" || filterStatus !== "all";

  const handleClearCompleted = async () => {
    // Filter out completed/failed tasks visually
    setFilterStatus("running");
    toast.success("Showing active tasks only");
  };

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Tasks</h1>
              <Badge variant="secondary">{tasks.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              View pending and completed Docker operations (auto-refreshes every 5s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={loadTasks}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            {tasks.some((t) => t.status === "succeeded" || t.status === "failed") && (
              <Button variant="outline" onClick={handleClearCompleted}>
                <Trash2 className="h-4 w-4 mr-1" />
                Hide Completed
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={() => {}}
        placeholder="Search tasks..."
        hasActiveFilters={hasActiveFilters}
        onReset={() => {
          setSearch("");
          setFilterNode("all");
          setFilterType("all");
          setFilterStatus("all");
        }}
        filters={
          <div className="flex items-center gap-2">
            <Select value={filterNode} onValueChange={setFilterNode}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Node" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All nodes</SelectItem>
                {dockerNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.displayName || n.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {taskTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="succeeded">Succeeded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {filteredTasks.length > 0 ? (
        <DataTable<DockerTask>
          columns={taskColumns}
          data={visibleTasks}
          keyFn={(t) => t.id}
          onRowClick={setSelectedTask}
          scrollRef={scrollRef}
          footer={hasMore ? (
            <div ref={sentinelRef} className="flex items-center justify-center py-3 text-xs text-muted-foreground">
              Loading more...
            </div>
          ) : undefined}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          Loading tasks...
        </div>
      ) : (
        <EmptyState
          message="No tasks found."
          hasActiveFilters={hasActiveFilters}
          onReset={() => {
            setSearch("");
            setFilterNode("all");
            setFilterType("all");
            setFilterStatus("all");
          }}
        />
      )}

      {/* Task Detail Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Task Details</DialogTitle>
          </DialogHeader>
          {selectedTask && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Type</span>
                <span className="text-sm font-medium">{selectedTask.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Container</span>
                <span className="text-sm">{selectedTask.containerName || selectedTask.containerId?.slice(0, 12) || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Node</span>
                <span className="text-sm">{nodeMap.get(selectedTask.nodeId) ?? selectedTask.nodeId.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge
                  variant={STATUS_BADGE[selectedTask.status] ?? "secondary"}
                  className={`text-xs ${selectedTask.status === "running" ? "animate-pulse" : ""}`}
                >
                  {selectedTask.status}
                </Badge>
              </div>
              {selectedTask.progress && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Progress</span>
                  <span className="text-sm">{selectedTask.progress}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm">{new Date(selectedTask.createdAt).toLocaleString()}</span>
              </div>
              {selectedTask.completedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Finished</span>
                  <span className="text-sm">{new Date(selectedTask.completedAt).toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Duration</span>
                <span className="text-sm">{formatDuration(selectedTask.createdAt, selectedTask.completedAt)}</span>
              </div>
              {selectedTask.error && (
                <div className="mt-2">
                  <span className="text-sm text-muted-foreground">Error</span>
                  <div className="mt-1 bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <pre className="text-xs text-destructive whitespace-pre-wrap break-all font-mono">
                      {selectedTask.error}
                    </pre>
                  </div>
                </div>
              )}
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
