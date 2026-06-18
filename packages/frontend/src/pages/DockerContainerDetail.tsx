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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
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
import { useStableNavigate } from "@/hooks/use-stable-navigate";
import { useUrlTab } from "@/hooks/use-url-tab";
import { formatDisplayImageRef } from "@/lib/docker-image-ref";
import { api } from "@/services/api";
import { ApiRequestError } from "@/services/api-base";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { usePinnedContainersStore } from "@/stores/pinned-containers";
import type { DockerHealthCheck } from "@/types";
import { ConfigTab } from "./docker-detail/ConfigTab";
import { ConsoleTab } from "./docker-detail/ConsoleTab";
import { EnvironmentTab } from "./docker-detail/EnvironmentTab";
import { FilesTab } from "./docker-detail/FilesTab";
import { containerDisplayName, type InspectData, STATUS_BADGE } from "./docker-detail/helpers";
import { LogsTab } from "./docker-detail/LogsTab";
import {
  buildContainerMutationSnapshot,
  shouldSettleMutationTransition,
  useContainerMutationTransition,
} from "./docker-detail/mutation-transition";
import { OverviewTab } from "./docker-detail/OverviewTab";
import { SettingsTab } from "./docker-detail/SettingsTab";
import { StatsTab } from "./docker-detail/StatsTab";
import { useContainerDetailRealtime } from "./docker-detail/useContainerDetailRealtime";

export {
  buildContainerMutationSnapshot,
  shouldSettleMutationTransition,
} from "./docker-detail/mutation-transition";

// ── Main Page ────────────────────────────────────────────────────

export function DockerContainerDetail() {
  const { nodeId, containerId } = useParams<{
    nodeId: string;
    containerId: string;
    tab?: string;
  }>();
  const navigate = useStableNavigate();
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
  const canViewContainer =
    hasScope("docker:containers:view") ||
    !!(nodeId && hasScope(`docker:containers:view:${nodeId}`));
  const canUseConsole =
    hasScope("docker:containers:console") ||
    !!(nodeId && hasScope(`docker:containers:console:${nodeId}`));
  const canUseFiles =
    hasScope("docker:containers:files") ||
    !!(nodeId && hasScope(`docker:containers:files:${nodeId}`));
  const canUseEnvironment =
    hasScope("docker:containers:environment") ||
    !!(nodeId && hasScope(`docker:containers:environment:${nodeId}`));
  const canUseSecrets =
    hasScope("docker:containers:secrets") ||
    !!(nodeId && hasScope(`docker:containers:secrets:${nodeId}`));
  const invalidate = useDockerStore((s) => s.invalidate);
  const setSelectedNode = useDockerStore((s) => s.setSelectedNode);
  const storeNodeId = useDockerStore((s) => s.selectedNodeId);
  const previousNodeIdRef = useRef<string | null>(null);

  // Temporarily scope store-backed invalidation to this node while the detail page is mounted,
  // then restore the previous list filter on unmount.
  useEffect(() => {
    previousNodeIdRef.current = storeNodeId;

    if (nodeId) {
      setSelectedNode(nodeId);
    }

    return () => {
      setSelectedNode(previousNodeIdRef.current);
    };
  }, [nodeId, setSelectedNode, storeNodeId]);
  const [container, setContainer] = useState<InspectData | null>(null);
  const containerRef = useRef<InspectData | null>(null);
  const [healthCheck, setHealthCheck] = useState<DockerHealthCheck | null>(null);

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
  const visibleTabs = useMemo(
    () => [
      "overview",
      ...(canViewContainer ? ["logs"] : []),
      ...(canUseConsole ? ["console"] : []),
      ...(canUseFiles ? ["files"] : []),
      ...(canViewContainer ? ["stats"] : []),
      ...(canUseEnvironment || canUseSecrets ? ["environment"] : []),
      ...(canEdit ? ["settings"] : []),
      ...(canViewContainer ? ["config"] : []),
    ],
    [canEdit, canUseConsole, canUseEnvironment, canUseFiles, canUseSecrets, canViewContainer]
  );
  const backendTransition = container?._transition as string | undefined;
  const { effectiveTransition, beginMutationTransition, clearMutationTransition } =
    useContainerMutationTransition(backendTransition);

  const fetchContainer = useCallback(
    async (silent = false, noCache = false) => {
      if (!nodeId || !containerId) return;
      if (!silent) setIsLoading(true);
      try {
        const data = await api.inspectContainer(nodeId, containerId, noCache);
        setContainer(data);
        if ((data as any)?._transition) {
          clearMutationTransition();
        }
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
    [clearMutationTransition, nodeId, containerId, navigate, updateMeta]
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
    const previousSignature = buildContainerMutationSnapshot(before);

    const attempts = [0, 250, 750, 1500, 2500, 3500];
    for (const delayMs of attempts) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const next = await api.inspectContainer(nodeId, containerId, true);
        setContainer(next);
        containerRef.current = next;
        if (shouldSettleMutationTransition(previousSignature, next)) {
          clearMutationTransition();
          return;
        }
      } catch {
        // Realtime/delete handlers already deal with hard failures; keep polling briefly.
      }
    }
  }, [clearMutationTransition, containerId, nodeId]);

  // Realtime: refetch on any container.changed event for this container's name.
  // Also handle the recreate ID migration for every open tab.
  const containerName = ((container?.Name ?? "") as string).replace(/^\//, "");

  const fetchHealthCheck = useCallback(async () => {
    if (!nodeId || !containerName) return;

    try {
      const next = await api.getContainerHealthCheck(nodeId, containerName);
      setHealthCheck(next);
    } catch {
      setHealthCheck(null);
    }
  }, [containerName, nodeId]);

  useEffect(() => {
    void fetchHealthCheck();
  }, [fetchHealthCheck]);
  useContainerDetailRealtime({
    nodeId,
    containerId,
    containerName,
    activeTab,
    navigate,
    fetchContainer,
    clearMutationTransition,
  });

  useRealtime("docker.health.changed", (payload) => {
    const ev = payload as {
      nodeId?: string;
      target?: string;
      containerName?: string;
    };
    if (ev.nodeId !== nodeId || ev.target !== "container" || ev.containerName !== containerName) {
      return;
    }

    void fetchHealthCheck();
  });

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, setActiveTab, visibleTabs]);

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
      description: `Remove "${containerDisplayName(container?.Name ?? "")}"? This cannot be undone.`,
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
    const dName = `${containerDisplayName(container?.Name ?? "")}-copy`;
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
    setRenameValue(containerDisplayName(container?.Name ?? ""));
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

  const name = containerDisplayName(container?.Name ?? "");
  const baseState = container?.State?.Status ?? (container?.State?.Running ? "running" : "stopped");
  const state = effectiveTransition ?? baseState;
  const image = container?.Config?.Image ?? "";
  const actionDisabled = actionLoading || !!effectiveTransition;
  const currentTransition = effectiveTransition;
  const currentBaseState = baseState;

  // Auto-navigate to overview and close popouts when container stops or enters transition
  useEffect(() => {
    const needsRunning = new Set(["console", "files", "stats"]);
    const shouldDisable = currentBaseState !== "running" || !!currentTransition;
    if (!shouldDisable) return;

    if (needsRunning.has(activeTab)) {
      setActiveTab("overview");
    }

    if (containerId) {
      try {
        const consoleChannel = new BroadcastChannel(`docker-console:${containerId}`);
        consoleChannel.postMessage({ type: "request-close" });
        consoleChannel.close();
      } catch {}
      try {
        const logsChannel = new BroadcastChannel(`docker-logs:${containerId}`);
        logsChannel.postMessage({ type: "request-close" });
        logsChannel.close();
      } catch {}
    }
  }, [activeTab, containerId, currentBaseState, currentTransition, setActiveTab]);

  if (isLoading || !container) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
    );
  }

  const headerActions = [
    {
      label: "Pin",
      icon: <Pin className="h-4 w-4" />,
      onClick: () => setPinOpen(true),
      disabled: actionDisabled,
    },
    ...(baseState !== "running" && canManage
      ? [
          {
            label: "Start",
            icon: <Play className="h-4 w-4" />,
            onClick: () =>
              doAction(() => api.startContainer(nodeId!, containerId!), "Container started"),
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(baseState === "running" && canManage
      ? [
          {
            label: "Stop",
            icon: <Square className="h-4 w-4" />,
            onClick: () =>
              doAction(() => api.stopContainer(nodeId!, containerId!), "Container stopping"),
            disabled: actionDisabled,
          },
          {
            label: "Restart",
            icon: <RotateCcw className="h-4 w-4" />,
            onClick: () =>
              doAction(() => api.restartContainer(nodeId!, containerId!), "Container restarting"),
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            label: "Rename",
            icon: <Type className="h-4 w-4" />,
            onClick: openRename,
            disabled: actionDisabled,
            separatorBefore: true,
          },
        ]
      : []),
    ...(canCreate
      ? [
          {
            label: "Duplicate",
            icon: <Copy className="h-4 w-4" />,
            onClick: handleDuplicate,
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(baseState === "running" && canManage
      ? [
          {
            label: "Kill",
            icon: <Skull className="h-4 w-4" />,
            onClick: () =>
              doAction(() => api.killContainer(nodeId!, containerId!), "Container killed"),
            disabled: actionDisabled,
            destructive: true,
            separatorBefore: true,
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: "Remove",
            icon: <Trash2 className="h-4 w-4" />,
            onClick: handleRemove,
            disabled: actionDisabled,
            destructive: true,
            separatorBefore: baseState !== "running" || !canManage,
          },
        ]
      : []),
  ];

  const isTerminalTab = activeTab === "console" || activeTab === "logs";
  const isStopped = baseState !== "running";
  const isTabDisabled = (tab: string) => {
    const needsRunning = new Set(["console", "files", "stats"]);
    if (tab === "environment" || tab === "settings") {
      return !!effectiveTransition;
    }
    return needsRunning.has(tab) && (!!effectiveTransition || isStopped);
  };

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${
          isTerminalTab ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => navigate("/docker")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-2xl font-bold">{name}</h1>
                <Badge variant={STATUS_BADGE[state] ?? "secondary"} className="shrink-0">
                  {state}
                </Badge>
              </div>
              <p className="break-all text-sm text-muted-foreground">
                {formatDisplayImageRef(image)} &middot;{" "}
                {(container.Id ?? containerId ?? "").slice(0, 12)}
              </p>
            </div>
          </div>

          <ResponsiveHeaderActions actions={headerActions}>
            <Button
              variant="outline"
              size="icon"
              disabled={actionDisabled}
              onClick={() => setPinOpen(true)}
            >
              <Pin className="h-4 w-4" />
            </Button>
            {baseState !== "running" && canManage && (
              <Button
                variant="outline"
                size="default"
                disabled={actionDisabled}
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
                  disabled={actionDisabled}
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
                  disabled={actionDisabled}
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
                <Button variant="outline" size="icon" disabled={actionDisabled}>
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
          </ResponsiveHeaderActions>
        </div>

        {healthCheck?.enabled && (
          <HealthBars
            history={healthCheck.healthHistory}
            currentStatus={healthCheck.healthStatus}
          />
        )}

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {canViewContainer && (
              <TabsTrigger value="logs" disabled={isTabDisabled("logs")}>
                Logs
              </TabsTrigger>
            )}
            {canUseConsole && (
              <TabsTrigger value="console" disabled={isTabDisabled("console")}>
                <TerminalIcon className="h-3.5 w-3.5 mr-1" />
                Console
              </TabsTrigger>
            )}
            {canUseFiles && (
              <TabsTrigger value="files" disabled={isTabDisabled("files")}>
                Files
              </TabsTrigger>
            )}
            {canViewContainer && (
              <TabsTrigger value="stats" disabled={isTabDisabled("stats")}>
                Monitoring
              </TabsTrigger>
            )}
            {(canUseEnvironment || canUseSecrets) && (
              <TabsTrigger value="environment" disabled={isTabDisabled("environment")}>
                Environment
              </TabsTrigger>
            )}
            {canEdit && (
              <TabsTrigger value="settings" disabled={isTabDisabled("settings")}>
                <Settings className="h-3.5 w-3.5 mr-1" />
                Settings
              </TabsTrigger>
            )}
            {canViewContainer && (
              <TabsTrigger value="config">
                <Code2 className="h-3.5 w-3.5 mr-1" />
                Config
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="overview" className="pb-0">
            <OverviewTab nodeId={nodeId!} containerId={containerId!} data={container} />
          </TabsContent>
          {canViewContainer && (
            <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 pb-0">
              <LogsTab
                nodeId={nodeId!}
                containerId={containerId!}
                containerState={state}
                inspectData={container}
              />
            </TabsContent>
          )}
          {canUseConsole && (
            <TabsContent value="console" className="flex flex-col flex-1 min-h-0">
              <ConsoleTab nodeId={nodeId!} containerId={containerId!} />
            </TabsContent>
          )}
          {canUseFiles && (
            <TabsContent value="files" className="pb-0">
              <FilesTab nodeId={nodeId!} containerId={containerId!} />
            </TabsContent>
          )}
          {canViewContainer && (
            <TabsContent value="stats" className="pb-0">
              <StatsTab nodeId={nodeId!} containerId={containerId!} data={container} />
            </TabsContent>
          )}
          {(canUseEnvironment || canUseSecrets) && (
            <TabsContent value="environment" className="flex flex-col flex-1 min-h-0 pb-0">
              <EnvironmentTab
                nodeId={nodeId!}
                containerId={containerId!}
                containerState={state}
                disabled={!!effectiveTransition}
                onMutationStart={beginMutationTransition}
                onMutationEnd={clearMutationTransition}
                onRecreating={refreshAfterMutation}
              />
            </TabsContent>
          )}
          {canEdit && (
            <TabsContent value="settings" className="pb-0">
              <SettingsTab
                nodeId={nodeId!}
                containerId={containerId!}
                data={container}
                onMutationStart={beginMutationTransition}
                onMutationEnd={clearMutationTransition}
                onRecreating={refreshAfterMutation}
                onRefresh={refreshAfterMutation}
                onHealthCheckSaved={setHealthCheck}
                transition={effectiveTransition}
              />
            </TabsContent>
          )}
          {canViewContainer && (
            <TabsContent value="config" className="flex flex-col flex-1 min-h-0 pb-0">
              <ConfigTab data={container} />
            </TabsContent>
          )}
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
                disabled={!!effectiveTransition}
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
            disabled={!!effectiveTransition}
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
            <Button
              onClick={handleRename}
              disabled={actionLoading || !!effectiveTransition || !renameValue.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
