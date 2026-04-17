import {
  ArrowLeft,
  Code2,
  Copy,
  EllipsisVertical,
  Pin,
  Play,
  RotateCcw,
  Settings,
  Skull,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { useUrlTab } from "@/hooks/use-url-tab";
import { api } from "@/services/api";
import { ApiRequestError } from "@/services/api-base";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { usePinnedContainersStore } from "@/stores/pinned-containers";
import { ConfigTab } from "./docker-detail/ConfigTab";
import { ConsoleTab } from "./docker-detail/ConsoleTab";
import { EnvironmentTab } from "./docker-detail/EnvironmentTab";
import { FilesTab } from "./docker-detail/FilesTab";
import { containerDisplayName, type InspectData, STATUS_BADGE } from "./docker-detail/helpers";
import { LogsTab } from "./docker-detail/LogsTab";
import { OverviewTab } from "./docker-detail/OverviewTab";
import { SettingsTab } from "./docker-detail/SettingsTab";
import { StatsTab } from "./docker-detail/StatsTab";

// ── Main Page ────────────────────────────────────────────────────

export function DockerContainerDetail() {
  const { nodeId, containerId } = useParams<{
    nodeId: string;
    containerId: string;
    tab?: string;
  }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const canManage =
    hasScope("docker:containers:manage") ||
    !!(nodeId && hasScope(`docker:containers:manage:${nodeId}`));
  const canEdit =
    hasScope("docker:containers:edit") ||
    !!(nodeId && hasScope(`docker:containers:edit:${nodeId}`));
  const canCreate =
    hasScope("docker:containers:create") ||
    !!(nodeId && hasScope(`docker:containers:create:${nodeId}`));
  const canDelete =
    hasScope("docker:containers:delete") ||
    !!(nodeId && hasScope(`docker:containers:delete:${nodeId}`));
  const invalidate = useDockerStore((s) => s.invalidate);
  const setSelectedNode = useDockerStore((s) => s.setSelectedNode);
  const storeNodeId = useDockerStore((s) => s.selectedNodeId);

  // Ensure the store knows which node we're on (needed for invalidate to work)
  useEffect(() => {
    if (nodeId && nodeId !== storeNodeId) {
      setSelectedNode(nodeId);
    }
  }, [nodeId, storeNodeId, setSelectedNode]);
  const [container, setContainer] = useState<InspectData | null>(null);
  const containerRef = useRef<InspectData | null>(null);

  const [activeTab, setActiveTab] = useUrlTab(
    ["overview", "logs", "console", "files", "stats", "environment", "settings", "config"],
    "overview",
    (tab) => `/docker/containers/${nodeId}/${containerId}/${tab}`
  );
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Pin
  const [pinOpen, setPinOpen] = useState(false);
  const { isPinnedSidebar, toggleSidebar, updateMeta } = usePinnedContainersStore();

  const fetchContainer = useCallback(
    async (silent = false, noCache = false) => {
      if (!nodeId || !containerId) return;
      if (!silent) setIsLoading(true);
      try {
        const data = await api.inspectContainer(nodeId, containerId, noCache);
        setContainer(data);
        // Keep pinned meta in sync
        if (usePinnedContainersStore.getState().isPinnedSidebar(containerId)) {
          const cName =
            String((data as any)?.Name ?? "").replace(/^\//, "") || containerId.slice(0, 12);
          const cState = (data as any)?._transition ?? (data as any)?.State?.Status ?? "unknown";
          updateMeta(containerId, { nodeId, name: cName, state: cState });
        }
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) {
          usePinnedContainersStore.getState().removePin(containerId);
        }
        if (!silent) {
          toast.error("Failed to load container");
          navigate("/docker");
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [nodeId, containerId, navigate, updateMeta]
  );

  useEffect(() => {
    fetchContainer();
    // Safety-net poll — realtime channel handles fast updates, this just
    // catches anything that slipped through (e.g. between reconnects).
    const interval = setInterval(() => fetchContainer(true), 30000);
    return () => clearInterval(interval);
  }, [fetchContainer]);

  useEffect(() => {
    containerRef.current = container;
  }, [container]);

  const refreshAfterMutation = useCallback(async () => {
    if (!nodeId || !containerId) return;

    const before = containerRef.current;
    const beforeConfig = (before?.Config ?? {}) as Record<string, any>;
    const beforeHostConfig = (before?.HostConfig ?? {}) as Record<string, any>;
    const beforeState = (before?.State ?? {}) as Record<string, any>;
    const previousSignature = before
      ? JSON.stringify({
          id: before.Id ?? "",
          image: beforeConfig.Image ?? "",
          env: beforeConfig.Env ?? [],
          ports: beforeHostConfig.PortBindings ?? {},
          mounts: before.Mounts ?? [],
          entrypoint: beforeConfig.Entrypoint ?? [],
          cmd: beforeConfig.Cmd ?? [],
          workingDir: beforeConfig.WorkingDir ?? "",
          user: beforeConfig.User ?? "",
          hostname: beforeConfig.Hostname ?? "",
          labels: beforeConfig.Labels ?? {},
          restartPolicy: beforeHostConfig.RestartPolicy ?? {},
          memory: beforeHostConfig.Memory ?? 0,
          memorySwap: beforeHostConfig.MemorySwap ?? 0,
          nanoCPUs: beforeHostConfig.NanoCPUs ?? 0,
          cpuShares: beforeHostConfig.CpuShares ?? 0,
          pidsLimit: beforeHostConfig.PidsLimit ?? 0,
          transition: (before as any)?._transition ?? null,
          state: beforeState.Status ?? "",
        })
      : "";

    const attempts = [0, 250, 750, 1500, 2500];
    for (const delayMs of attempts) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const next = await api.inspectContainer(nodeId, containerId, true);
        setContainer(next);
        containerRef.current = next;
        const nextConfig = (next.Config ?? {}) as Record<string, any>;
        const nextHostConfig = (next.HostConfig ?? {}) as Record<string, any>;
        const nextState = (next.State ?? {}) as Record<string, any>;

        const nextSignature = JSON.stringify({
          id: next.Id ?? "",
          image: nextConfig.Image ?? "",
          env: nextConfig.Env ?? [],
          ports: nextHostConfig.PortBindings ?? {},
          mounts: next.Mounts ?? [],
          entrypoint: nextConfig.Entrypoint ?? [],
          cmd: nextConfig.Cmd ?? [],
          workingDir: nextConfig.WorkingDir ?? "",
          user: nextConfig.User ?? "",
          hostname: nextConfig.Hostname ?? "",
          labels: nextConfig.Labels ?? {},
          restartPolicy: nextHostConfig.RestartPolicy ?? {},
          memory: nextHostConfig.Memory ?? 0,
          memorySwap: nextHostConfig.MemorySwap ?? 0,
          nanoCPUs: nextHostConfig.NanoCPUs ?? 0,
          cpuShares: nextHostConfig.CpuShares ?? 0,
          pidsLimit: nextHostConfig.PidsLimit ?? 0,
          transition: (next as any)?._transition ?? null,
          state: nextState.Status ?? "",
        });

        if (nextSignature !== previousSignature || (next as any)?._transition) {
          return;
        }
      } catch {
        // Realtime/delete handlers already deal with hard failures; keep polling briefly.
      }
    }
  }, [containerId, nodeId]);

  // Realtime: refetch on any container.changed event for this container's name.
  // Also handle the recreate ID migration for every open tab.
  const containerName = ((container?.Name ?? "") as string).replace(/^\//, "");
  useRealtime("docker.container.changed", (payload) => {
    const ev = payload as {
      nodeId?: string;
      name?: string;
      id?: string;
      oldId?: string;
      action?: string;
    };
    if (!ev || ev.nodeId !== nodeId) return;
    const matchesName = containerName && ev.name === containerName;
    const matchesId = ev.id === containerId || ev.oldId === containerId;
    if (!matchesName && !matchesId) return;

    if (ev.action === "recreated" && ev.id && ev.oldId && ev.id !== containerId) {
      // Migrate any pinned references and rewrite the URL so this tab now
      // points at the new container ID.
      try {
        usePinnedContainersStore.getState().migrateId(ev.oldId, ev.id);
      } catch {
        /* ignore */
      }
      navigate(`/docker/containers/${nodeId}/${ev.id}/${activeTab}`, { replace: true });
      return;
    }
    if (ev.action === "removed" && (ev.id === containerId || ev.name === containerName)) {
      // Container was deleted by someone else — bounce back to the list
      toast.info("Container was removed");
      navigate("/docker");
      return;
    }
    void fetchContainer(true);
  });

  const currentTransition = container?._transition as string | undefined;

  // Auto-navigate to overview and close popouts when container stops or enters transition
  const currentBaseState =
    container?.State?.Status ?? (container?.State?.Running ? "running" : "stopped");
  useEffect(() => {
    if (!container) return; // Don't reset tabs while data is loading
    const needsRunning = new Set(["console", "files", "stats"]);
    const shouldDisable = currentBaseState !== "running" || !!currentTransition;
    if (!shouldDisable) return;

    if (needsRunning.has(activeTab)) {
      setActiveTab("overview");
    }

    // Close any open popout windows for this container
    if (containerId) {
      try {
        const consoleChannel = new BroadcastChannel(`docker-console:${containerId}`);
        consoleChannel.postMessage({ type: "request-close" });
        consoleChannel.close();
      } catch {
        /* */
      }
      try {
        const logsChannel = new BroadcastChannel(`docker-logs:${containerId}`);
        logsChannel.postMessage({ type: "request-close" });
        logsChannel.close();
      } catch {
        /* */
      }
    }
  }, [activeTab, container, containerId, currentBaseState, currentTransition, setActiveTab]);

  if (isLoading || !container) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
    );
  }

  // ── Action helpers ──
  const doAction = async (fn: () => Promise<void>, successMsg: string) => {
    setActionLoading(true);
    try {
      await fn();
      toast.success(successMsg);
      invalidate("containers", "tasks");
      fetchContainer();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async () => {
    const ok = await confirm({
      title: "Remove Container",
      description: `Remove "${containerDisplayName(container.Name ?? "")}"? This cannot be undone.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setActionLoading(true);
    try {
      await api.removeContainer(nodeId!, containerId!, true);
      usePinnedContainersStore.getState().removePin(containerId!);
      toast.success("Container removed");
      invalidate("containers", "tasks");
      navigate("/docker");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
      setActionLoading(false);
    }
  };

  const handleDuplicate = async () => {
    const dName = `${containerDisplayName(container.Name ?? "")}-copy`;
    setActionLoading(true);
    try {
      const result = await api.duplicateContainer(nodeId!, containerId!, dName);
      toast.success("Container duplicated");
      await invalidate("containers");
      const newId = (result as any)?.id;
      if (newId) {
        navigate(`/docker/containers/${nodeId}/${newId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate");
    } finally {
      setActionLoading(false);
    }
  };

  const openRename = () => {
    setRenameValue(containerDisplayName(container.Name ?? ""));
    setRenameOpen(true);
  };

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    setActionLoading(true);
    try {
      await api.renameContainer(nodeId!, containerId!, renameValue.trim());
      toast.success("Container renamed");
      setRenameOpen(false);
      invalidate("containers");
      fetchContainer();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setActionLoading(false);
    }
  };

  const name = containerDisplayName(container.Name ?? "");
  const transition = container._transition as string | undefined;
  const baseState = container.State?.Status ?? (container.State?.Running ? "running" : "stopped");
  const state = transition ?? baseState;
  const image = container.Config?.Image ?? "";

  const isTerminalTab = activeTab === "console" || activeTab === "logs";
  const isStopped = baseState !== "running";
  const isTabDisabled = (tab: string) => {
    const needsRunning = new Set(["console", "files", "stats"]);
    return needsRunning.has(tab) && (!!transition || isStopped);
  };

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${
          isTerminalTab ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/docker")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{name}</h1>
                <Badge variant={STATUS_BADGE[state] ?? "secondary"}>{state}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {image} &middot; {(container.Id ?? containerId ?? "").slice(0, 12)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setPinOpen(true)}>
              <Pin className="h-4 w-4" />
            </Button>
            {baseState !== "running" && canManage && (
              <Button
                variant="outline"
                size="default"
                disabled={actionLoading || !!transition}
                onClick={() =>
                  doAction(() => api.startContainer(nodeId!, containerId!), "Container started")
                }
              >
                <Play className="h-3.5 w-3.5" />
                Start
              </Button>
            )}
            {baseState === "running" && canManage && (
              <>
                <Button
                  variant="outline"
                  size="default"
                  disabled={actionLoading || !!transition}
                  onClick={() =>
                    doAction(() => api.stopContainer(nodeId!, containerId!), "Container stopping")
                  }
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  disabled={actionLoading || !!transition}
                  onClick={() =>
                    doAction(
                      () => api.restartContainer(nodeId!, containerId!),
                      "Container restarting"
                    )
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restart
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" disabled={actionLoading || !!transition}>
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onClick={openRename}>
                    <Type className="h-3.5 w-3.5 mr-2" />
                    Rename
                  </DropdownMenuItem>
                )}
                {canCreate && (
                  <DropdownMenuItem onClick={handleDuplicate}>
                    <Copy className="h-3.5 w-3.5 mr-2" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {baseState === "running" && canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        doAction(() => api.killContainer(nodeId!, containerId!), "Container killed")
                      }
                      className="text-destructive"
                    >
                      <Skull className="h-3.5 w-3.5 mr-2" />
                      Kill
                    </DropdownMenuItem>
                  </>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleRemove} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="logs" disabled={isTabDisabled("logs")}>
              Logs
            </TabsTrigger>
            <TabsTrigger value="console" disabled={isTabDisabled("console")}>
              <TerminalIcon className="h-3.5 w-3.5 mr-1" />
              Console
            </TabsTrigger>
            <TabsTrigger value="files" disabled={isTabDisabled("files")}>
              Files
            </TabsTrigger>
            <TabsTrigger value="stats" disabled={isTabDisabled("stats")}>
              Monitoring
            </TabsTrigger>
            <TabsTrigger value="environment">Environment</TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-3.5 w-3.5 mr-1" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="config">
              <Code2 className="h-3.5 w-3.5 mr-1" />
              Config
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pb-0">
            <OverviewTab nodeId={nodeId!} containerId={containerId!} data={container} />
          </TabsContent>
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 pb-0">
            <LogsTab
              nodeId={nodeId!}
              containerId={containerId!}
              containerState={state}
              inspectData={container}
            />
          </TabsContent>
          <TabsContent value="console" className="flex flex-col flex-1 min-h-0">
            <ConsoleTab nodeId={nodeId!} containerId={containerId!} />
          </TabsContent>
          <TabsContent value="files" className="pb-0">
            <FilesTab nodeId={nodeId!} containerId={containerId!} />
          </TabsContent>
          <TabsContent value="stats" className="pb-0">
            <StatsTab nodeId={nodeId!} containerId={containerId!} data={container} />
          </TabsContent>
          <TabsContent value="environment" className="flex flex-col flex-1 min-h-0 pb-0">
            <EnvironmentTab
              nodeId={nodeId!}
              containerId={containerId!}
              containerState={state}
              disabled={!!transition}
              onRecreating={refreshAfterMutation}
            />
          </TabsContent>
          <TabsContent value="settings" className="pb-0">
            <SettingsTab
              nodeId={nodeId!}
              containerId={containerId!}
              data={container}
              onRecreating={refreshAfterMutation}
              onRefresh={refreshAfterMutation}
              transition={transition}
            />
          </TabsContent>
          <TabsContent value="config" className="flex flex-col flex-1 min-h-0 pb-0">
            <ConfigTab data={container} />
          </TabsContent>
        </Tabs>
      </div>
      {/* Pin Dialog */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pin Container</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to sidebar</p>
                <p className="text-xs text-muted-foreground">Quick access link in the sidebar</p>
              </div>
              <Switch
                checked={isPinnedSidebar(containerId!)}
                onChange={() => {
                  toggleSidebar(containerId!, { nodeId: nodeId!, name, state: baseState });
                  usePinnedContainersStore.getState().invalidate();
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Container</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="New container name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={actionLoading || !renameValue.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
