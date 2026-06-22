import { Check, Copy, FolderPlus, Plus, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { FolderedResourceList } from "@/components/common/FolderedResourceList";
import { PageTransition } from "@/components/common/PageTransition";
import type { ResourceListColumn } from "@/components/common/ResourceListLayout";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDaemonUpdatesStore } from "@/stores/daemon-updates";
import { useNodesStore } from "@/stores/nodes";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import type { Node, NodeStatus } from "@/types";
import { effectiveNodeStatus, isNodeIncompatible, isNodeUpdating } from "@/types";

const NODE_TYPES = [
  {
    value: "nginx",
    label: "Nginx",
    description: "Reverse proxy node running nginx",
    disabled: false,
  },
  {
    value: "docker",
    label: "Docker",
    description: "Docker container management agent",
    disabled: false,
  },
  {
    value: "monitoring",
    label: "Monitoring",
    description: "System monitoring agent — no nginx required",
    disabled: false,
  },
  {
    value: "bastion",
    label: "Bastion",
    description: "SSH bastion host (coming soon)",
    disabled: true,
  },
];

const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  online: "success",
  offline: "destructive",
  degraded: "warning",
  pending: "secondary",
  error: "destructive",
};

function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

function formatDaemonVersion(version: string | null | undefined): string {
  if (!version) return "";
  return version.startsWith("v") ? version : `v${version}`;
}

export function AdminNodes() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const { nodes, isLoading, filters, total, fetchNodes, setFilters, resetFilters } =
    useNodesStore();

  const [searchInput, setSearchInput] = useState(filters.search);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [enrollType, setEnrollType] = useState<string>("nginx");
  const [enrollDisplayName, setEnrollDisplayName] = useState("");
  const [enrollToken, setEnrollToken] = useState<string | null>(null);
  const [gatewayCertSha256, setGatewayCertSha256] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [createFolderAction, setCreateFolderAction] = useState<(() => void) | null>(null);
  const daemonUpdates = useDaemonUpdatesStore((s) => s.statuses);
  const fetchDaemonUpdates = useDaemonUpdatesStore((s) => s.fetchDaemonUpdates);

  const loadDaemonUpdates = useCallback(
    async (options?: { force?: boolean }) => {
      if (!hasScope("admin:update")) return;
      try {
        await fetchDaemonUpdates(options);
      } catch {
        // ignore
      }
    },
    [fetchDaemonUpdates, hasScope]
  );

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  useRealtime("node.changed", () => {
    void loadDaemonUpdates({ force: true });
  });

  // Fetch daemon update statuses
  useEffect(() => {
    void loadDaemonUpdates();
  }, [loadDaemonUpdates]);

  const handleSearch = () => setFilters({ search: searchInput });
  const hasActiveFilters = filters.search !== "" || filters.status !== "all";
  const canManageFolders = hasScope("nodes:folders:manage");

  const handleDelete = useCallback(
    async (nodeId: string, hostname: string) => {
      const ok = await confirm({
        title: "Remove Node",
        description: `Are you sure you want to remove "${hostname}"? This cannot be undone.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
      try {
        await api.deleteNode(nodeId);
        usePinnedNodesStore.getState().removePin(nodeId);
        toast.success("Node removed");
        fetchNodes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove node");
      }
    },
    [fetchNodes]
  );

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      const result = await api.createNode({
        type: enrollType,
        hostname: "pending",
        displayName: enrollDisplayName.trim() || undefined,
      });
      setEnrollToken(result.enrollmentToken);
      setGatewayCertSha256(result.gatewayCertSha256);
      fetchNodes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create node");
    } finally {
      setEnrolling(false);
    }
  };

  const closeEnrollDialog = () => {
    setEnrollDialogOpen(false);
    setEnrollType("nginx");
    setEnrollDisplayName("");
    setEnrollToken(null);
    setGatewayCertSha256(null);
    setCopiedField(null);
  };

  const gatewayAddr = `${window.location.hostname}:9443`;
  const scriptUrl = "https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-daemon.sh";

  const curlCommand =
    enrollToken && gatewayCertSha256
      ? `curl -sSL ${scriptUrl} | sudo bash -s -- \\\n  --type ${enrollType} --gateway ${gatewayAddr} --token ${enrollToken} --gateway-cert-sha256 ${gatewayCertSha256}`
      : "";

  const wgetCommand =
    enrollToken && gatewayCertSha256
      ? `wget -qO- ${scriptUrl} | sudo bash -s -- \\\n  --type ${enrollType} --gateway ${gatewayAddr} --token ${enrollToken} --gateway-cert-sha256 ${gatewayCertSha256}`
      : "";

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text.replace(/\\\n\s*/g, ""));
    setCopiedField(field);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const columns = useMemo<ResourceListColumn<Node>[]>(
    () => [
      {
        id: "name",
        label: "Name",
        width: "34%",
        renderCell: (node) => (
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-muted">
              <Server className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{node.displayName || node.hostname}</p>
              <p className="truncate text-xs text-muted-foreground">
                {node.displayName ? node.hostname : ""} {formatDaemonVersion(node.daemonVersion)}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "type",
        label: "Type",
        width: "13%",
        align: "center",
        renderCell: (node) => <Badge variant="secondary">{node.type}</Badge>,
      },
      {
        id: "lock",
        label: "Lock",
        width: "13%",
        align: "center",
        renderCell: (node) =>
          (node.type === "nginx" || node.type === "docker") && node.serviceCreationLocked ? (
            <Badge variant="warning">LOCKED</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "lastSeen",
        label: "Last Seen",
        width: "16%",
        align: "center",
        renderCell: (node) => <Badge variant="outline">{formatLastSeen(node.lastSeenAt)}</Badge>,
      },
      {
        id: "status",
        label: "Status",
        width: "14%",
        align: "center",
        renderCell: (node) => {
          if (isNodeUpdating(node)) return <Badge variant="warning">UPDATING</Badge>;
          if (isNodeIncompatible(node)) return <Badge variant="destructive">INCOMPATIBLE</Badge>;
          const typeStatus = daemonUpdates.find((s) => s.daemonType === node.type);
          const nodeStatus = typeStatus?.nodes.find((n) => n.nodeId === node.id);
          if (nodeStatus?.updateAvailable && typeStatus?.latestVersion) {
            return (
              <Badge style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}>
                {typeStatus.latestVersion}
              </Badge>
            );
          }
          const eStatus = effectiveNodeStatus(node);
          return <Badge variant={STATUS_BADGE[eStatus] || "secondary"}>{eStatus}</Badge>;
        },
      },
      {
        id: "actions",
        label: "Actions",
        width: "10%",
        align: "right",
        renderCell: (node) =>
          hasScope("nodes:delete") ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={isNodeUpdating(node)}
              onClick={(event) => {
                event.stopPropagation();
                void handleDelete(node.id, node.hostname);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null,
      },
    ],
    [daemonUpdates, hasScope, handleDelete]
  );

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Nodes</h1>
            <p className="text-sm text-muted-foreground">
              {total} node{total !== 1 ? "s" : ""} registered
            </p>
          </div>
          <ResponsiveHeaderActions
            actions={[
              ...(canManageFolders && createFolderAction
                ? [
                    {
                      label: "Add Folder",
                      icon: <FolderPlus className="h-4 w-4" />,
                      onClick: createFolderAction,
                    },
                  ]
                : []),
              ...(hasScope("nodes:create")
                ? [
                    {
                      label: "Add Node",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => setEnrollDialogOpen(true),
                    },
                  ]
                : []),
            ]}
          >
            {canManageFolders && (
              <Button variant="outline" onClick={() => createFolderAction?.()}>
                <FolderPlus className="h-4 w-4" />
                Add Folder
              </Button>
            )}
            {hasScope("nodes:create") && (
              <Button onClick={() => setEnrollDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Node
              </Button>
            )}
          </ResponsiveHeaderActions>
        </div>

        <FolderedResourceList<Node>
          resourceType="node"
          realtimeChannel="node.folder.changed"
          resources={nodes}
          columns={columns}
          search={{
            search: searchInput,
            onSearchChange: setSearchInput,
            onSearchSubmit: handleSearch,
            placeholder: "Search by hostname...",
            hasActiveFilters,
            onReset: () => {
              setSearchInput("");
              resetFilters();
            },
            filters: (
              <Select
                value={filters.status}
                onValueChange={(v) => setFilters({ status: v as NodeStatus | "all" })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            ),
          }}
          loading={isLoading}
          loadingLabel="Loading nodes..."
          emptyState={
            <EmptyState
              message="No nodes found. Add a node to start managing nginx instances remotely."
              actionLabel={hasScope("nodes:create") ? "Add Node" : undefined}
              onAction={hasScope("nodes:create") ? () => setEnrollDialogOpen(true) : undefined}
              hasActiveFilters={hasActiveFilters}
              onReset={() => {
                setSearchInput("");
                resetFilters();
              }}
            />
          }
          minWidth={900}
          canManageFolders={canManageFolders}
          canViewItem={(node) => hasScope("nodes:details") || hasScope(`nodes:details:${node.id}`)}
          canReorganizeItem={() => canManageFolders}
          getResourceLabel={(node) => node.displayName || node.hostname}
          onItemClick={(node) => navigate(`/nodes/${node.id}`)}
          onRefresh={() => fetchNodes()}
          onCreateFolderRef={(fn) => setCreateFolderAction(() => fn)}
        />
      </div>

      {/* Enrollment Dialog */}
      <Dialog open={enrollDialogOpen} onOpenChange={closeEnrollDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{enrollToken ? "Node Created" : "Add Node"}</DialogTitle>
            {!enrollToken && (
              <DialogDescription>
                Create a node entry and get the setup command to run on the target host.
              </DialogDescription>
            )}
          </DialogHeader>

          {!enrollToken ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Node Type</label>
                <Select value={enrollType} onValueChange={setEnrollType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NODE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} disabled={t.disabled}>
                        <div className="flex items-center gap-2">
                          <span>{t.label}</span>
                          {t.disabled && (
                            <span className="text-xs text-muted-foreground">(coming soon)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {NODE_TYPES.find((t) => t.value === enrollType)?.description}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Display Name <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  className="mt-1"
                  value={enrollDisplayName}
                  onChange={(e) => setEnrollDisplayName(e.target.value)}
                  placeholder="US-East Proxy"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 p-3">
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  The enrollment token is single-use and will not be shown again.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Setup Command</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Run on the target host as root.{" "}
                  {enrollType === "docker"
                    ? "Installs the Docker management daemon and enrolls with this Gateway."
                    : enrollType === "monitoring"
                      ? "Installs the monitoring agent and enrolls with this Gateway."
                      : "Installs nginx, the daemon, and enrolls with this Gateway."}
                </p>
                <div className="mb-2 border border-amber-500/20 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    If Gateway is behind Cloudflare, replace the generated{" "}
                    <span className="font-mono">--gateway</span> host with the actual Gateway server
                    IP or a hostname that exposes <span className="font-mono">9443/tcp</span>{" "}
                    directly, but keep the generated{" "}
                    <span className="font-mono">--gateway-cert-sha256</span> fingerprint.
                  </p>
                </div>
                <Tabs defaultValue="curl">
                  <TabsList>
                    <TabsTrigger value="curl">curl</TabsTrigger>
                    <TabsTrigger value="wget">wget</TabsTrigger>
                  </TabsList>
                  <TabsContent value="curl">
                    <CommandBlock
                      command={curlCommand}
                      copied={copiedField === "curl"}
                      onCopy={() => copyToClipboard(curlCommand, "curl")}
                    />
                  </TabsContent>
                  <TabsContent value="wget">
                    <CommandBlock
                      command={wgetCommand}
                      copied={copiedField === "wget"}
                      onCopy={() => copyToClipboard(wgetCommand, "wget")}
                    />
                  </TabsContent>
                </Tabs>
              </div>

              <div>
                <label className="text-sm font-medium">Enrollment Token</label>
                <p className="text-xs text-muted-foreground mb-2">
                  For manual setup. See the documentation for details.
                </p>
                <CommandBlock
                  command={enrollToken!}
                  copied={copiedField === "token"}
                  onCopy={() => copyToClipboard(enrollToken!, "token")}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {!enrollToken ? (
              <>
                <Button variant="outline" onClick={closeEnrollDialog}>
                  Cancel
                </Button>
                <Button onClick={handleEnroll} disabled={enrolling}>
                  {enrolling ? "Creating..." : "Create Node"}
                </Button>
              </>
            ) : (
              <Button onClick={closeEnrollDialog}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

function CommandBlock({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <pre className="text-xs bg-muted p-3 pr-10 font-mono whitespace-pre-wrap break-all border border-border min-h-12 flex items-center">
        {command}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1.5 right-1.5 h-7 w-7"
        onClick={onCopy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
