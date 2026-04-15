import { ArrowLeft, ArrowUpCircle, EllipsisVertical, Pencil, Pin, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HealthBars } from "@/components/ui/health-bars";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { useUrlTab } from "@/hooks/use-url-tab";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useNodesStore } from "@/stores/nodes";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import type { NodeDetail } from "@/types";
import {
  effectiveNodeStatus,
  getNodeUpdateTargetVersion,
  isNodeIncompatible,
  isNodeUpdating,
} from "@/types";
import { DockerContainers } from "./DockerContainers";
import { DockerImages } from "./DockerImages";
import { DockerNetworks } from "./DockerNetworks";
import { DockerVolumes } from "./DockerVolumes";
import { NodeConfigTab } from "./node-detail/NodeConfigTab";
import { NodeConsoleTab } from "./node-detail/NodeConsoleTab";
import { NodeDetailsTab } from "./node-detail/NodeDetailsTab";
import { NodeLogsTab } from "./node-detail/NodeLogsTab";
import { NodeMonitoringTab } from "./node-detail/NodeMonitoringTab";
import { NodeNginxLogsTab } from "./node-detail/NodeNginxLogsTab";

const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  online: "success",
  offline: "destructive",
  degraded: "warning",
  pending: "secondary",
  error: "destructive",
  updating: "warning",
};

export function AdminNodeDetail() {
  const { id } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const nodeRefreshTick = useNodesStore((s) => s.refreshTick);

  const [activeTab, setActiveTab] = useUrlTab(
    [
      "details",
      "monitoring",
      "console",
      "configuration",
      "nginx-logs",
      "containers",
      "images",
      "volumes",
      "networks",
      "daemon-logs",
    ],
    "details",
    (tab) => `/nodes/${id}/${tab}`
  );

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Pin dialog
  const [pinOpen, setPinOpen] = useState(false);
  const { isPinnedDashboard, isPinnedSidebar, toggleDashboard, toggleSidebar } =
    usePinnedNodesStore();

  const loadNode = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setIsLoading(true);
      try {
        const data = await api.getNode(id);
        setNode(data);
      } catch {
        if (!silent) {
          toast.error("Failed to load node");
          navigate("/nodes");
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [id, navigate]
  );

  useEffect(() => {
    loadNode();
    const interval = setInterval(() => loadNode(true), 30000);
    return () => clearInterval(interval);
  }, [loadNode]);

  // Refetch on live node.changed events (triggered by RealtimeBridge → store invalidation)
  useEffect(() => {
    if (nodeRefreshTick > 0) loadNode(true);
  }, [nodeRefreshTick, loadNode]);

  useRealtime(id ? "node.changed" : null, (payload) => {
    const event = payload as { id?: string; action?: string };
    if (!id || event.id !== id) return;
    if (event.action === "deleted") {
      navigate("/nodes");
      return;
    }
    loadNode(true);
  });

  const handleRename = async () => {
    if (!id) return;
    setRenaming(true);
    try {
      const updated = await api.updateNode(id, {
        displayName: renameName.trim() || undefined,
      });
      setNode((prev) => (prev ? { ...prev, ...updated } : prev));
      setRenameOpen(false);
      usePinnedNodesStore.getState().invalidate();
      toast.success("Node updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!node) return;
    const ok = await confirm({
      title: "Remove Node",
      description: `Are you sure you want to remove "${node.hostname}"?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.deleteNode(node.id);
      toast.success("Node removed");
      navigate("/nodes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleCheckUpdates = async () => {
    if (!node) return;
    setCheckingUpdates(true);
    try {
      const statuses = await api.checkDaemonUpdates();
      const typeStatus = statuses.find((status) => status.daemonType === node.type);
      const nodeStatus = typeStatus?.nodes.find((status) => status.nodeId === node.id);

      if (nodeStatus?.updateAvailable && typeStatus?.latestVersion) {
        toast.info(`Update available: ${typeStatus.latestVersion}`);
      } else {
        toast.success("Node daemon is already up to date");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check daemon updates");
    } finally {
      setCheckingUpdates(false);
    }
  };

  if (isLoading || !node) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
    );
  }

  const nodeUpdating = isNodeUpdating(node);
  const updateTargetVersion = getNodeUpdateTargetVersion(node);
  const nodeState = nodeUpdating ? "updating" : effectiveNodeStatus(node);

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${activeTab === "configuration" || activeTab === "daemon-logs" || activeTab === "nginx-logs" || activeTab === "console" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {/* Header — matches ProxyHostDetail pattern */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/nodes")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{node.displayName || node.hostname}</h1>
                <Badge variant={STATUS_BADGE[nodeState] || "secondary"}>{nodeState}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {node.hostname} &middot; {node.type} &middot;{" "}
                {node.daemonVersion ?? "unknown version"}
                {nodeUpdating && updateTargetVersion ? (
                  <> &middot; updating to {updateTargetVersion}</>
                ) : null}
                {node.osInfo ? <> &middot; {node.osInfo}</> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setPinOpen(true)}>
              <Pin className="h-4 w-4" />
            </Button>
            {hasScope("nodes:rename") && (
              <Button
                variant="outline"
                disabled={nodeUpdating}
                onClick={() => {
                  setRenameName(node.displayName ?? "");
                  setRenameOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                Rename
              </Button>
            )}
            {(hasScope("admin:update") || hasScope("nodes:delete")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" disabled={checkingUpdates || nodeUpdating}>
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hasScope("admin:update") && (
                    <DropdownMenuItem onClick={handleCheckUpdates} disabled={nodeUpdating}>
                      <ArrowUpCircle className="h-3.5 w-3.5 mr-2" />
                      Check for updates
                    </DropdownMenuItem>
                  )}
                  {hasScope("admin:update") && hasScope("nodes:delete") && (
                    <DropdownMenuSeparator />
                  )}
                  {hasScope("nodes:delete") && (
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Health bars */}
        <HealthBars history={node.healthHistory} currentStatus={node.status} />

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            {!isNodeIncompatible(node) && <TabsTrigger value="monitoring">Monitoring</TabsTrigger>}
            {!isNodeIncompatible(node) && node.type === "nginx" && (
              <TabsTrigger value="configuration">Configuration</TabsTrigger>
            )}
            {!isNodeIncompatible(node) && node.type === "nginx" && (
              <TabsTrigger value="nginx-logs">Nginx Logs</TabsTrigger>
            )}
            {!isNodeIncompatible(node) && node.type === "docker" && (
              <>
                <TabsTrigger value="containers">Containers</TabsTrigger>
                <TabsTrigger value="images">Images</TabsTrigger>
                <TabsTrigger value="volumes">Volumes</TabsTrigger>
                <TabsTrigger value="networks">Networks</TabsTrigger>
              </>
            )}
            {!isNodeIncompatible(node) && node.status === "online" && hasScope("nodes:console") && (
              <TabsTrigger value="console">Console</TabsTrigger>
            )}
            <TabsTrigger value="daemon-logs">Daemon Logs</TabsTrigger>
          </TabsList>

          {isNodeIncompatible(node) && (
            <div className="bg-destructive/10 border border-destructive/20 p-3 mt-2 rounded-md">
              <p className="text-sm text-destructive font-medium">
                This node's daemon version is incompatible with the gateway. Update the daemon to
                restore full functionality.
              </p>
            </div>
          )}

          <div className="relative flex flex-col flex-1 min-h-0">
            <TabsContent value="details" className="pb-6">
              <NodeDetailsTab node={node} />
            </TabsContent>
            {!isNodeIncompatible(node) && (
              <TabsContent value="monitoring" className="pb-6">
                <NodeMonitoringTab nodeId={node.id} nodeStatus={node.status} nodeType={node.type} />
              </TabsContent>
            )}
            {!isNodeIncompatible(node) && node.type === "nginx" && (
              <TabsContent value="configuration" className="flex flex-col flex-1 min-h-0">
                <NodeConfigTab
                  nodeId={node.id}
                  nodeStatus={node.status}
                  actionLocked={nodeUpdating}
                />
              </TabsContent>
            )}
            {!isNodeIncompatible(node) && node.type === "nginx" && (
              <TabsContent value="nginx-logs" className="flex flex-col flex-1 min-h-0">
                <NodeNginxLogsTab nodeId={node.id} nodeStatus={node.status} />
              </TabsContent>
            )}
            {!isNodeIncompatible(node) && node.type === "docker" && (
              <>
                <TabsContent value="containers" className="flex flex-col flex-1 min-h-0">
                  <DockerContainers embedded fixedNodeId={node.id} />
                </TabsContent>
                <TabsContent value="images" className="flex flex-col flex-1 min-h-0">
                  <DockerImages embedded fixedNodeId={node.id} />
                </TabsContent>
                <TabsContent value="volumes" className="flex flex-col flex-1 min-h-0">
                  <DockerVolumes embedded fixedNodeId={node.id} />
                </TabsContent>
                <TabsContent value="networks" className="flex flex-col flex-1 min-h-0">
                  <DockerNetworks embedded fixedNodeId={node.id} />
                </TabsContent>
              </>
            )}
            {!isNodeIncompatible(node) && node.status === "online" && hasScope("nodes:console") && (
              <TabsContent value="console" className="flex flex-col flex-1 min-h-0">
                <NodeConsoleTab nodeId={node.id} />
              </TabsContent>
            )}
            <TabsContent value="daemon-logs" className="flex flex-col flex-1 min-h-0">
              <NodeLogsTab nodeId={node.id} nodeStatus={node.status} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Node</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input
              className="mt-1"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder={node.hostname}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave empty to use the hostname ({node.hostname})
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renaming}>
              {renaming ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pin Dialog */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pin Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to dashboard</p>
                <p className="text-xs text-muted-foreground">Show overview card on the dashboard</p>
              </div>
              <Switch
                checked={isPinnedDashboard(node.id)}
                onChange={() => toggleDashboard(node.id)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to sidebar</p>
                <p className="text-xs text-muted-foreground">Quick access link in the sidebar</p>
              </div>
              <Switch checked={isPinnedSidebar(node.id)} onChange={() => toggleSidebar(node.id)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
