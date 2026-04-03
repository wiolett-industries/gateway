import { Box, Minus, Play, Plus, RefreshCw, Search, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
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

interface PortMapping {
  hostPort: string;
  containerPort: string;
}

interface EnvEntry {
  key: string;
  value: string;
}

export function DockerContainers() {
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

  const [searchInput, setSearchInput] = useState(filters.search);
  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);

  // Action loading states keyed by container id
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Deploy dialog state
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployImage, setDeployImage] = useState("");
  const [deployName, setDeployName] = useState("");
  const [deployRestart, setDeployRestart] = useState("no");
  const [deployPorts, setDeployPorts] = useState<PortMapping[]>([]);
  const [deployEnv, setDeployEnv] = useState<EnvEntry[]>([]);
  const [deploying, setDeploying] = useState(false);

  // Fetch docker nodes on mount — intentionally runs once
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    setNodesLoading(true);
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) => {
        setDockerNodes(r.data);
        // Auto-select first node if none selected
        if (!selectedNodeId && r.data.length > 0) {
          setSelectedNode(r.data[0].id);
        }
      })
      .catch(() => {
        toast.error("Failed to load Docker nodes");
      })
      .finally(() => setNodesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch containers on mount and auto-refresh every 30s
  useEffect(() => {
    if (!selectedNodeId) return;
    // Always fetch fresh on mount/re-render of this effect
    fetchContainers();
    const interval = setInterval(() => fetchContainers(), 30_000);
    return () => clearInterval(interval);
  }, [selectedNodeId, fetchContainers]);

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
    return result;
  }, [containers, filters]);

  const hasActiveFilters = filters.search !== "" || filters.status !== "all";

  // Container actions
  const doAction = async (containerId: string, action: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [containerId]: action }));
    try {
      await fn();
      toast.success(`Container ${action} successful`);
      fetchContainers();
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

  const handleStart = (c: DockerContainer) =>
    doAction(c.id, "start", () => api.startContainer(selectedNodeId!, c.id));

  const handleStop = (c: DockerContainer) =>
    doAction(c.id, "stop", () => api.stopContainer(selectedNodeId!, c.id));

  const handleRestart = (c: DockerContainer) =>
    doAction(c.id, "restart", () => api.restartContainer(selectedNodeId!, c.id));

  // Deploy container
  const handleDeploy = async () => {
    if (!selectedNodeId || !deployImage.trim()) return;
    setDeploying(true);
    try {
      const config: ContainerCreateConfig = {
        image: deployImage.trim(),
        restartPolicy: deployRestart,
      };
      if (deployName.trim()) config.name = deployName.trim();
      if (deployPorts.length > 0) {
        config.ports = deployPorts
          .filter((p) => p.hostPort && p.containerPort)
          .map((p) => ({
            hostPort: Number.parseInt(p.hostPort, 10),
            containerPort: Number.parseInt(p.containerPort, 10),
          }));
      }
      if (deployEnv.length > 0) {
        const env: Record<string, string> = {};
        for (const e of deployEnv) {
          if (e.key.trim()) env[e.key.trim()] = e.value;
        }
        if (Object.keys(env).length > 0) config.env = env;
      }
      await api.createContainer(selectedNodeId, config);
      toast.success("Container deployed");
      closeDeploy();
      fetchContainers();
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
    setDeployPorts([]);
    setDeployEnv([]);
  };

  const selectedNode = dockerNodes.find((n) => n.id === selectedNodeId);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
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
              <Button onClick={() => setDeployOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Deploy Container
              </Button>
            )}
          </div>
        </div>

        {/* Inline: [Node selector] [Search input] [Status filter] */}
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
              placeholder="Search containers by name or image..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setFilters({ search: e.target.value });
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Select value={filters.status} onValueChange={(v) => setFilters({ status: v })}>
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!selectedNodeId && !nodesLoading && dockerNodes.length === 0 && (
          <EmptyState message="No Docker nodes registered. Add a Docker node from the Nodes page to get started." />
        )}

        {!selectedNodeId && !nodesLoading && dockerNodes.length > 0 && (
          <EmptyState message="Select a node to view its containers." />
        )}

        {selectedNodeId && (
          <>

            {/* Container list */}
            {filteredContainers.length > 0 ? (
              <div className="border border-border rounded-lg bg-card">
                {/* Table header */}
                <div className="hidden md:grid md:grid-cols-[1fr_1fr_120px_140px_100px] gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Name</span>
                  <span>Image</span>
                  <span>Status</span>
                  <span>Created</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredContainers.map((c) => {
                    const loadingAction = actionLoading[c.id];
                    return (
                      <div
                        key={c.id}
                        className="flex flex-col md:grid md:grid-cols-[1fr_1fr_120px_140px_100px] gap-2 md:gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-colors items-start md:items-center"
                        onClick={() => navigate(`/docker/containers/${selectedNodeId}/${c.id}`)}
                      >
                        {/* Name */}
                        <div className="flex items-center gap-3 min-w-0">
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

                        {/* Image */}
                        <p className="text-sm text-muted-foreground truncate">{c.image}</p>

                        {/* Status */}
                        <Badge
                          variant={STATUS_BADGE[(c as any)._transition ?? c.state] ?? "secondary"}
                          className="text-xs w-fit"
                        >
                          {(c as any)._transition ?? c.state}
                        </Badge>

                        {/* Created */}
                        <span className="text-sm text-muted-foreground">
                          {formatCreated(c.created)}
                        </span>

                        {/* Actions */}
                        <div
                          className="flex items-center gap-0.5 md:justify-end"
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
                      </div>
                    );
                  })}
                </div>
              </div>
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
                onAction={hasScope("docker:containers:create") ? () => setDeployOpen(true) : undefined}
              />
            )}
          </>
        )}
      </div>

      {/* Deploy Container Dialog */}
      <Dialog open={deployOpen} onOpenChange={closeDeploy}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deploy Container</DialogTitle>
            <DialogDescription>
              Create and start a new container on{" "}
              {selectedNode?.displayName || selectedNode?.hostname || "the selected node"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Image */}
            <div>
              <label className="text-sm font-medium">
                Image <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                value={deployImage}
                onChange={(e) => setDeployImage(e.target.value)}
                placeholder="nginx:latest"
              />
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

            {/* Port mappings */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Port Mappings</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDeployPorts((prev) => [...prev, { hostPort: "", containerPort: "" }])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {deployPorts.map((port, idx) => (
                <div key={idx} className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder="Host port"
                    value={port.hostPort}
                    onChange={(e) => {
                      const updated = [...deployPorts];
                      updated[idx] = { ...updated[idx], hostPort: e.target.value };
                      setDeployPorts(updated);
                    }}
                    className="w-28"
                  />
                  <span className="text-muted-foreground text-sm">:</span>
                  <Input
                    placeholder="Container port"
                    value={port.containerPort}
                    onChange={(e) => {
                      const updated = [...deployPorts];
                      updated[idx] = { ...updated[idx], containerPort: e.target.value };
                      setDeployPorts(updated);
                    }}
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setDeployPorts((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Environment variables */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Environment Variables</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeployEnv((prev) => [...prev, { key: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {deployEnv.map((env, idx) => (
                <div key={idx} className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder="KEY"
                    value={env.key}
                    onChange={(e) => {
                      const updated = [...deployEnv];
                      updated[idx] = { ...updated[idx], key: e.target.value };
                      setDeployEnv(updated);
                    }}
                    className="w-36"
                  />
                  <span className="text-muted-foreground text-sm">=</span>
                  <Input
                    placeholder="value"
                    value={env.value}
                    onChange={(e) => {
                      const updated = [...deployEnv];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      setDeployEnv(updated);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setDeployEnv((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDeploy}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying || !deployImage.trim()}>
              {deploying ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
