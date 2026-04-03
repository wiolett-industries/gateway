import { AlertCircle, ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useDockerStore } from "@/stores/docker";
import type { Node } from "@/types";

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

export function DockerTasks() {
  const { tasks, fetchTasks } = useDockerStore();

  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterNode, setFilterNode] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const hasActiveFilters =
    search !== "" || filterNode !== "all" || filterType !== "all" || filterStatus !== "all";

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearCompleted = async () => {
    // Filter out completed/failed tasks visually
    setFilterStatus("running");
    toast.success("Showing active tasks only");
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
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
          <div className="border border-border rounded-lg bg-card">
            <div className="hidden md:grid md:grid-cols-[28px_120px_1fr_140px_100px_80px_100px_80px] gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span />
              <span>Type</span>
              <span>Container</span>
              <span>Node</span>
              <span>Status</span>
              <span>Progress</span>
              <span>Started</span>
              <span>Duration</span>
            </div>
            <div className="divide-y divide-border">
              {filteredTasks.map((task) => {
                const isExpanded = expandedIds.has(task.id);
                return (
                  <div key={task.id}>
                    <div
                      className="flex flex-col md:grid md:grid-cols-[28px_120px_1fr_140px_100px_80px_100px_80px] gap-2 md:gap-4 p-4 items-start md:items-center cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => task.error && toggleExpand(task.id)}
                    >
                      <div className="flex items-center">
                        {task.error ? (
                          isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : (
                          <span className="w-4" />
                        )}
                      </div>
                      <span className="text-sm font-medium">{task.type}</span>
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground truncate">
                          {task.containerName || task.containerId?.slice(0, 12) || "-"}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground truncate">
                        {nodeMap.get(task.nodeId) ?? task.nodeId.slice(0, 8)}
                      </span>
                      <Badge
                        variant={STATUS_BADGE[task.status] ?? "secondary"}
                        className={`text-xs w-fit ${task.status === "running" ? "animate-pulse" : ""}`}
                      >
                        {task.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {task.progress ?? "-"}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatTime(task.createdAt)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatDuration(task.createdAt, task.completedAt)}
                      </span>
                    </div>
                    {isExpanded && task.error && (
                      <div className="px-4 pb-4">
                        <div className="bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <pre className="text-xs text-destructive whitespace-pre-wrap break-all font-mono">
                            {task.error}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
      </div>
    </PageTransition>
  );
}
