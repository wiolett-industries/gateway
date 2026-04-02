import { ArrowLeft, Pencil, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { HealthBars } from "@/components/ui/health-bars";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import type { NodeDetail, NodeStatus } from "@/types";
import { NodeConfigTab } from "./node-detail/NodeConfigTab";
import { NodeDetailsTab } from "./node-detail/NodeDetailsTab";
import { NodeLogsTab } from "./node-detail/NodeLogsTab";
import { NodeMonitoringTab } from "./node-detail/NodeMonitoringTab";
import { NodeNginxLogsTab } from "./node-detail/NodeNginxLogsTab";

const STATUS_BADGE: Record<
  NodeStatus,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  online: "success",
  offline: "warning",
  pending: "secondary",
  error: "destructive",
};

export function AdminNodeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("details");

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Pin dialog
  const [pinOpen, setPinOpen] = useState(false);
  const { isPinnedDashboard, isPinnedSidebar, toggleDashboard, toggleSidebar } =
    usePinnedNodesStore();

  useEffect(() => {
    if (!id) return;
    const load = async (silent = false) => {
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
    };
    load();
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [id, navigate]);

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

  if (isLoading || !node) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${activeTab === "configuration" || activeTab === "daemon-logs" || activeTab === "nginx-logs" ? "overflow-hidden" : "overflow-y-auto"}`}
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
                <Badge variant={STATUS_BADGE[node.status]}>{node.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {node.hostname} &middot; {node.type} &middot;{" "}
                {node.daemonVersion ? `v${node.daemonVersion}` : "unknown version"}
                {node.osInfo ? <> &middot; {node.osInfo}</> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setPinOpen(true)}>
              <Pin className="h-4 w-4" />
            </Button>
            {hasScope("nodes:manage") && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRenameName(node.displayName ?? "");
                    setRenameOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Rename
                </Button>
                <Button variant="outline" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Health bars */}
        {node.status === "online" && (
          <HealthBars hourlyHistory={node.healthHistory} />
        )}

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
            <TabsTrigger value="nginx-logs">Nginx Logs</TabsTrigger>
            <TabsTrigger value="daemon-logs">Daemon Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <NodeDetailsTab node={node} />
          </TabsContent>
          <TabsContent value="monitoring">
            <NodeMonitoringTab nodeId={node.id} nodeStatus={node.status} />
          </TabsContent>
          <TabsContent value="configuration" className="flex flex-col flex-1 min-h-0">
            <NodeConfigTab nodeId={node.id} nodeStatus={node.status} />
          </TabsContent>
          <TabsContent value="nginx-logs" className="flex flex-col flex-1 min-h-0">
            <NodeNginxLogsTab nodeId={node.id} nodeStatus={node.status} />
          </TabsContent>
          <TabsContent value="daemon-logs" className="flex flex-col flex-1 min-h-0">
            <NodeLogsTab nodeId={node.id} nodeStatus={node.status} />
          </TabsContent>
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
