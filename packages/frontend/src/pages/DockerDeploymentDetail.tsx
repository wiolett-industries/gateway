import {
  ArrowLeft,
  ArrowRight,
  ClipboardCopy,
  Code2,
  EllipsisVertical,
  Pin,
  Play,
  RotateCcw,
  Settings,
  Skull,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { DetailRow } from "@/components/common/DetailRow";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { DockerHealthCheckSection } from "@/components/docker/DockerHealthCheckSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  type DockerRuntimeCapacity,
  loadDockerRuntimeCapacity,
  UNKNOWN_DOCKER_RUNTIME_CAPACITY,
} from "@/lib/docker-runtime-capacity";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { usePinnedContainersStore } from "@/stores/pinned-containers";
import type {
  DockerDeployment,
  DockerDeploymentRelease,
  DockerDeploymentSlot,
  DockerHealthCheck,
  DockerWebhook,
} from "@/types";
import { ConsoleTab } from "./docker-detail/ConsoleTab";
import { EnvironmentTab } from "./docker-detail/EnvironmentTab";
import { FilesTab } from "./docker-detail/FilesTab";
import {
  copyToClipboard,
  formatBytes,
  formatDate,
  type InspectData,
  STATUS_BADGE,
} from "./docker-detail/helpers";
import { LabelsSection } from "./docker-detail/LabelsSection";
import { LogsTab } from "./docker-detail/LogsTab";
import { type PortMapping, PortMappingsSection } from "./docker-detail/PortMappingsSection";
import { RuntimeSection } from "./docker-detail/RuntimeSection";
import { WebhookSection } from "./docker-detail/SettingsTab";
import { StatsTab } from "./docker-detail/StatsTab";
import { type MountEntry, VolumeMountsSection } from "./docker-detail/VolumeMountsSection";

function getActiveSlot(deployment: DockerDeployment | null): DockerDeploymentSlot | null {
  if (!deployment) return null;
  return deployment.slots.find((slot) => slot.slot === deployment.activeSlot) ?? null;
}

function statusVariant(
  status?: string
): "default" | "secondary" | "destructive" | "success" | "warning" {
  if (!status) return "secondary";
  if (STATUS_BADGE[status]) return STATUS_BADGE[status];
  if (status === "ready" || status === "healthy" || status === "succeeded") return "success";
  if (status === "failed" || status === "unhealthy") return "destructive";
  if (
    status === "deploying" ||
    status === "draining" ||
    status === "pending" ||
    status === "starting" ||
    status === "stopping" ||
    status === "restarting" ||
    status === "killing" ||
    status === "removing" ||
    status === "switching" ||
    status === "rolling_back"
  )
    return "warning";
  return "secondary";
}

function isTransitionStatus(status?: string | null) {
  return (
    status === "creating" ||
    status === "deploying" ||
    status === "switching" ||
    status === "starting" ||
    status === "stopping" ||
    status === "restarting" ||
    status === "killing" ||
    status === "removing" ||
    status === "rolling_back"
  );
}

function transitionForAction(name: string) {
  if (name.startsWith("switch-")) return "switching";
  if (name.startsWith("stop-")) return "stopping";
  const transitionByAction: Record<string, string> = {
    deploy: "deploying",
    switch: "switching",
    rollback: "rolling_back",
    start: "starting",
    stop: "stopping",
    restart: "restarting",
    kill: "killing",
    remove: "removing",
  };
  return transitionByAction[name];
}

function shortId(value?: string | null) {
  return value ? value.slice(0, 12) : "-";
}

function splitImageRef(imageRef: string) {
  const digestIndex = imageRef.indexOf("@");
  if (digestIndex >= 0) {
    return { imageName: imageRef, tag: "" };
  }

  const lastColon = imageRef.lastIndexOf(":");
  const lastSlash = imageRef.lastIndexOf("/");
  if (lastColon === -1 || lastSlash > lastColon) {
    return { imageName: imageRef, tag: "" };
  }

  return { imageName: imageRef.slice(0, lastColon), tag: imageRef.slice(lastColon + 1) };
}

function joinImageRef(imageName: string, tag: string) {
  return tag.trim() ? `${imageName}:${tag.trim()}` : imageName;
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeMounts(mounts: unknown): MountEntry[] {
  if (!Array.isArray(mounts)) return [];
  return mounts.map((mount) => {
    const value = mount as Partial<MountEntry>;
    return {
      hostPath: value.hostPath ?? "",
      containerPath: value.containerPath ?? "",
      name: value.name ?? "",
      readOnly: value.readOnly ?? false,
    };
  });
}

function normalizeLabels(labels: unknown): Array<{ key: string; value: string }> {
  return Object.entries((labels ?? {}) as Record<string, string>).map(([key, value]) => ({
    key,
    value,
  }));
}

function Section({
  title,
  badge,
  actions,
  active,
  children,
}: {
  title: string;
  badge?: string | number;
  actions?: React.ReactNode;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-border bg-card"
      style={active ? { borderColor: "#fff" } : undefined}
    >
      <div
        className={`flex items-center justify-between border-b border-border px-4 ${actions ? "py-3" : "py-4"}`}
      >
        <h2 className="font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {badge !== undefined && <Badge variant="secondary">{badge}</Badge>}
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

export function DockerDeploymentDetail() {
  const { nodeId = "", deploymentId = "" } = useParams();
  const navigate = useStableNavigate();
  const { hasScope } = useAuthStore();
  const canManage =
    hasScope("docker:containers:manage") ||
    !!(nodeId && hasScope(`docker:containers:manage:${nodeId}`));
  const canDelete =
    hasScope("docker:containers:delete") ||
    !!(nodeId && hasScope(`docker:containers:delete:${nodeId}`));
  const canEdit =
    hasScope("docker:containers:edit") ||
    !!(nodeId && hasScope(`docker:containers:edit:${nodeId}`));
  const canManageWebhooks =
    hasScope("docker:containers:webhooks") ||
    !!(nodeId && hasScope(`docker:containers:webhooks:${nodeId}`));
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
  const canEditMounts =
    hasScope("docker:containers:mounts") ||
    !!(nodeId && hasScope(`docker:containers:mounts:${nodeId}`));

  const [deployment, setDeployment] = useState<DockerDeployment | null>(null);
  const [activeInspect, setActiveInspect] = useState<InspectData | null>(null);
  const [webhook, setWebhook] = useState<DockerWebhook | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const { isPinnedSidebar, toggleSidebar, updateMeta } = usePinnedContainersStore();

  const [activeTab, setActiveTab] = useUrlTab(
    ["overview", "logs", "console", "files", "stats", "environment", "slots", "settings", "config"],
    "overview",
    (tab) => `/docker/deployments/${nodeId}/${deploymentId}/${tab}`
  );

  const load = useCallback(async () => {
    if (!nodeId || !deploymentId) return;
    setLoading(true);
    try {
      const next = await api.getDockerDeployment(nodeId, deploymentId);
      setDeployment(next);
      setWebhook(next.webhook ?? null);
      if (usePinnedContainersStore.getState().isPinnedSidebar(deploymentId)) {
        updateMeta(deploymentId, {
          nodeId,
          name: next.name,
          state: next._transition ?? next.status,
          kind: "deployment",
        });
      }

      const slot = getActiveSlot(next);
      if (slot?.containerId) {
        const inspect = await api
          .inspectContainer(nodeId, slot.containerId, true)
          .catch(() => null);
        setActiveInspect(inspect);
      } else {
        setActiveInspect(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load deployment");
      navigate("/docker");
    } finally {
      setLoading(false);
    }
  }, [deploymentId, navigate, nodeId, updateMeta]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("docker.deployment.changed", (payload) => {
    const event = payload as {
      nodeId?: string;
      deploymentId?: string;
      action?: string;
      transition?: string;
    };
    if (event.nodeId !== nodeId || event.deploymentId !== deploymentId) return;

    if (event.action === "transitioning" && event.transition) {
      setDeployment((current) =>
        current ? { ...current, _transition: event.transition } : current
      );
      return;
    }

    if (event.action === "deleted" || event.action === "removed") {
      navigate("/docker");
      return;
    }

    void load();
  });

  useRealtime("docker.container.changed", (payload) => {
    const event = payload as {
      nodeId?: string;
      deploymentId?: string;
      action?: string;
      transition?: string;
    };
    if (event.nodeId !== nodeId || event.deploymentId !== deploymentId) return;
    if (event.action === "deployment") return;

    if (event.action === "transitioning" && event.transition) {
      setDeployment((current) =>
        current ? { ...current, _transition: event.transition } : current
      );
      return;
    }

    void load();
  });

  useRealtime("docker.health.changed", (payload) => {
    const event = payload as {
      nodeId?: string;
      deploymentId?: string;
      target?: string;
    };
    if (
      event.nodeId !== nodeId ||
      event.target !== "deployment" ||
      event.deploymentId !== deploymentId
    ) {
      return;
    }

    void load();
  });

  const primaryRoute = useMemo(
    () => deployment?.routes.find((route) => route.isPrimary) ?? deployment?.routes[0] ?? null,
    [deployment]
  );
  const active = getActiveSlot(deployment);
  const activeContainerId = active?.containerId ?? "";
  const activeBaseState =
    activeInspect?.State?.Status ?? (activeInspect?.State?.Running ? "running" : active?.status);
  const activeState = activeBaseState ?? "unknown";
  const serviceTransition = deployment?._transition;
  const serviceBusy = !!serviceTransition || isTransitionStatus(deployment?.status);
  const serviceState =
    serviceTransition ??
    (deployment?.status === "ready"
      ? activeState === "unknown"
        ? "running"
        : activeState
      : (deployment?.status ?? activeState));
  const isRunning = activeState === "running";
  const isStopped = deployment?.status === "stopped" || !isRunning;
  const isTerminalTab = activeTab === "logs" || activeTab === "console";
  const serviceEnv = useMemo(() => {
    return deployment?.desiredConfig.env ?? {};
  }, [deployment?.desiredConfig.env]);
  const drainingSlot = useMemo(
    () =>
      deployment?.slots.find(
        (slot) => slot.slot !== deployment.activeSlot && slot.status === "draining"
      ),
    [deployment]
  );

  const visibleTabs = useMemo(
    () => [
      "overview",
      ...(canViewContainer ? ["logs"] : []),
      ...(canUseConsole ? ["console"] : []),
      ...(canUseFiles ? ["files"] : []),
      ...(canViewContainer ? ["stats"] : []),
      ...(canUseEnvironment ? ["environment"] : []),
      "slots",
      ...(canEdit ? ["settings"] : []),
      "config",
    ],
    [canEdit, canUseConsole, canUseEnvironment, canUseFiles, canViewContainer]
  );

  const isTabDisabled = useCallback(
    (tabName: string) => {
      if (!activeContainerId) return ["logs", "console", "files", "stats"].includes(tabName);
      return ["console", "files", "stats"].includes(tabName) && (!isRunning || serviceBusy);
    },
    [activeContainerId, isRunning, serviceBusy]
  );

  useEffect(() => {
    if (!visibleTabs.includes(activeTab) || isTabDisabled(activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, isTabDisabled, setActiveTab, visibleTabs]);

  const runAction = async (name: string, fn: () => Promise<void>) => {
    setAction(name);
    const transition = transitionForAction(name);
    if (transition) {
      setDeployment((current) => (current ? { ...current, _transition: transition } : current));
    }
    try {
      await fn();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deployment action failed");
      await load().catch(() => {
        if (transition) {
          setDeployment((current) =>
            current?._transition === transition ? { ...current, _transition: undefined } : current
          );
        }
      });
    } finally {
      setAction(null);
    }
  };

  const saveServiceEnv = useCallback(
    async (env: Record<string, string>) => {
      const next = await api.updateDockerDeployment(nodeId, deploymentId, {
        desiredConfig: { env },
      });
      setDeployment(next);
      setWebhook(next.webhook ?? null);
    },
    [deploymentId, nodeId]
  );

  const removeDeployment = async () => {
    if (!deployment) return;
    const ok = await confirm({
      title: "Remove Deployment",
      description: `Remove "${deployment.name}"? This will remove the router, slot containers, and deployment network.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await runAction("remove", async () => {
      await api.deleteDockerDeployment(nodeId, deployment.id);
      usePinnedContainersStore.getState().removePin(deployment.id);
      toast.success("Deployment removed");
      navigate("/docker");
    });
  };

  if (loading && !deployment) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
    );
  }

  if (!deployment) return null;

  const actionDisabled = !!action || serviceBusy;
  const headerActions = [
    {
      label: "Pin",
      icon: <Pin className="h-4 w-4" />,
      onClick: () => setPinOpen(true),
    },
    ...(isStopped && canManage
      ? [
          {
            label: "Start",
            icon: <Play className="h-4 w-4" />,
            onClick: () =>
              runAction("start", async () => {
                await api.startDockerDeployment(nodeId, deployment.id);
                toast.success("Deployment started");
              }),
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(!isStopped && canManage
      ? [
          {
            label: "Stop",
            icon: <Square className="h-4 w-4" />,
            onClick: () =>
              runAction("stop", async () => {
                await api.stopDockerDeployment(nodeId, deployment.id);
                toast.success("Deployment stopped");
              }),
            disabled: actionDisabled,
          },
          {
            label: "Restart",
            icon: <RotateCcw className="h-4 w-4" />,
            onClick: () =>
              runAction("restart", async () => {
                await api.restartDockerDeployment(nodeId, deployment.id);
                toast.success("Deployment restarted");
              }),
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            label: "Rollback",
            icon: <RotateCcw className="h-4 w-4" />,
            onClick: () =>
              runAction("rollback", async () => {
                await api.rollbackDockerDeployment(nodeId, deployment.id);
                toast.success("Rollback started");
              }),
            disabled: actionDisabled,
            separatorBefore: true,
          },
        ]
      : []),
    ...(!isStopped && canManage && drainingSlot?.containerId
      ? [
          {
            label: "Stop draining slot",
            icon: <Square className="h-4 w-4" />,
            onClick: () =>
              runAction(`stop-${drainingSlot.slot}`, async () => {
                await api.stopDockerDeploymentSlot(nodeId, deployment.id, drainingSlot.slot);
                toast.success("Draining slot stopped");
              }),
            disabled: actionDisabled,
          },
        ]
      : []),
    ...(!isStopped && canManage
      ? [
          {
            label: "Kill",
            icon: <Skull className="h-4 w-4" />,
            onClick: () =>
              runAction("kill", async () => {
                await api.killDockerDeployment(nodeId, deployment.id);
                toast.success("Deployment killed");
              }),
            disabled: actionDisabled,
            destructive: true,
            separatorBefore: !drainingSlot?.containerId,
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: "Remove",
            icon: <Trash2 className="h-4 w-4" />,
            onClick: removeDeployment,
            disabled: actionDisabled,
            destructive: true,
            separatorBefore: isStopped || !canManage,
          },
        ]
      : []),
  ];

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${
          isTerminalTab ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
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
                <h1 className="truncate text-2xl font-bold">{deployment.name}</h1>
                <Badge variant={statusVariant(serviceState)} className="shrink-0">
                  {serviceState}
                </Badge>
                <Badge variant="outline" className="shrink-0">
                  blue/green
                </Badge>
              </div>
              <p className="break-all text-sm text-muted-foreground">
                {active?.image ?? deployment.desiredConfig.image} &middot; active{" "}
                {deployment.activeSlot}
              </p>
            </div>
          </div>

          <ResponsiveHeaderActions actions={headerActions}>
            <Button variant="outline" size="icon" onClick={() => setPinOpen(true)}>
              <Pin className="h-4 w-4" />
            </Button>
            {isStopped && canManage && (
              <Button
                variant="outline"
                disabled={actionDisabled}
                onClick={() =>
                  runAction("start", async () => {
                    await api.startDockerDeployment(nodeId, deployment.id);
                    toast.success("Deployment started");
                  })
                }
              >
                <Play className="h-3.5 w-3.5" />
                Start
              </Button>
            )}
            {!isStopped && canManage && (
              <>
                <Button
                  variant="outline"
                  disabled={actionDisabled}
                  onClick={() =>
                    runAction("stop", async () => {
                      await api.stopDockerDeployment(nodeId, deployment.id);
                      toast.success("Deployment stopped");
                    })
                  }
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
                <Button
                  variant="outline"
                  disabled={actionDisabled}
                  onClick={() =>
                    runAction("restart", async () => {
                      await api.restartDockerDeployment(nodeId, deployment.id);
                      toast.success("Deployment restarted");
                    })
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
                {canManage && (
                  <DropdownMenuItem
                    onClick={() =>
                      runAction("rollback", async () => {
                        await api.rollbackDockerDeployment(nodeId, deployment.id);
                        toast.success("Rollback started");
                      })
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-2" />
                    Rollback
                  </DropdownMenuItem>
                )}
                {!isStopped && canManage && (
                  <>
                    <DropdownMenuSeparator />
                    {drainingSlot?.containerId && (
                      <DropdownMenuItem
                        onClick={() =>
                          runAction(`stop-${drainingSlot.slot}`, async () => {
                            await api.stopDockerDeploymentSlot(
                              nodeId,
                              deployment.id,
                              drainingSlot.slot
                            );
                            toast.success("Draining slot stopped");
                          })
                        }
                      >
                        <Square className="h-3.5 w-3.5 mr-2" />
                        Stop draining slot
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() =>
                        runAction("kill", async () => {
                          await api.killDockerDeployment(nodeId, deployment.id);
                          toast.success("Deployment killed");
                        })
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
                    <DropdownMenuItem onClick={removeDeployment} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </ResponsiveHeaderActions>
        </div>

        {deployment.healthCheck?.enabled && (
          <HealthBars
            history={deployment.healthCheck.healthHistory}
            currentStatus={deployment.healthCheck.healthStatus}
          />
        )}

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
            {canUseEnvironment && <TabsTrigger value="environment">Environment</TabsTrigger>}
            <TabsTrigger value="slots">Slots</TabsTrigger>
            {canEdit && (
              <TabsTrigger value="settings">
                <Settings className="h-3.5 w-3.5 mr-1" />
                Settings
              </TabsTrigger>
            )}
            <TabsTrigger value="config">
              <Code2 className="h-3.5 w-3.5 mr-1" />
              Config
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pb-0">
            <DeploymentOverview
              deployment={deployment}
              active={active}
              serviceState={serviceState}
              activeState={activeState}
              primaryRoute={primaryRoute}
            />
          </TabsContent>
          {canViewContainer && activeContainerId && (
            <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 pb-0">
              <LogsTab
                nodeId={nodeId}
                containerId={activeContainerId}
                containerState={activeState}
                inspectData={activeInspect ?? undefined}
              />
            </TabsContent>
          )}
          {canUseConsole && activeContainerId && (
            <TabsContent value="console" className="flex flex-col flex-1 min-h-0">
              <ConsoleTab nodeId={nodeId} containerId={activeContainerId} />
            </TabsContent>
          )}
          {canUseFiles && activeContainerId && (
            <TabsContent value="files" className="pb-0">
              <FilesTab nodeId={nodeId} containerId={activeContainerId} />
            </TabsContent>
          )}
          {canViewContainer && activeContainerId && activeInspect && (
            <TabsContent value="stats" className="pb-0">
              <StatsTab nodeId={nodeId} containerId={activeContainerId} data={activeInspect} />
            </TabsContent>
          )}
          {canUseEnvironment && (
            <TabsContent value="environment" className="pb-0">
              <EnvironmentTab
                nodeId={nodeId}
                containerId={deployment.id}
                containerState={activeState}
                serviceEnv={serviceEnv}
                onSaveServiceEnv={saveServiceEnv}
              />
            </TabsContent>
          )}
          <TabsContent value="slots" className="pb-0">
            <DeploymentSlots
              deployment={deployment}
              nodeId={nodeId}
              action={action}
              serviceBusy={serviceBusy}
              runAction={runAction}
              canManage={canManage}
            />
          </TabsContent>
          {canEdit && (
            <TabsContent value="settings" className="pb-0">
              <DeploymentSettings
                deployment={deployment}
                nodeId={nodeId}
                action={action}
                webhook={webhook}
                setWebhook={setWebhook}
                onHealthCheckSaved={(healthCheck) =>
                  setDeployment((current) => (current ? { ...current, healthCheck } : current))
                }
                canEditMounts={canEditMounts}
                canManageWebhooks={canManageWebhooks}
                runAction={runAction}
              />
            </TabsContent>
          )}
          <TabsContent value="config" className="flex flex-col flex-1 min-h-0 pb-0">
            <DeploymentConfig deployment={deployment} />
          </TabsContent>
        </Tabs>
      </div>
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pin Deployment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to sidebar</p>
                <p className="text-xs text-muted-foreground">Quick access link in the sidebar</p>
              </div>
              <Switch
                checked={isPinnedSidebar(deployment.id)}
                onChange={() => {
                  toggleSidebar(deployment.id, {
                    nodeId,
                    name: deployment.name,
                    state: deployment._transition ?? deployment.status,
                    kind: "deployment",
                  });
                  usePinnedContainersStore.getState().invalidate();
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

function DeploymentOverview({
  deployment,
  active,
  serviceState,
  activeState,
  primaryRoute,
}: {
  deployment: DockerDeployment;
  active: DockerDeploymentSlot | null;
  serviceState: string;
  activeState: string;
  primaryRoute: DockerDeployment["routes"][number] | null;
}) {
  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="General">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Status"
              value={<Badge variant={statusVariant(serviceState)}>{serviceState}</Badge>}
            />
            <DetailRow
              label="Deployment ID"
              value={
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-mono hover:text-primary cursor-pointer"
                  onClick={() => copyToClipboard(deployment.id)}
                >
                  {shortId(deployment.id)}
                  <ClipboardCopy className="h-3 w-3" />
                </button>
              }
            />
            <DetailRow
              label="Desired Image"
              value={<span className="font-mono">{deployment.desiredConfig.image}</span>}
            />
            <DetailRow
              label="Active Image"
              value={<span className="font-mono">{active?.image ?? "-"}</span>}
            />
            <DetailRow label="Created" value={formatDate(deployment.createdAt)} />
            <DetailRow label="Updated" value={formatDate(deployment.updatedAt)} />
          </div>
        </Section>

        <Section title="Active Slot">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Slot"
              value={<span className="capitalize">{deployment.activeSlot}</span>}
            />
            <DetailRow
              label="Health"
              value={
                <Badge variant={statusVariant(active?.health)}>{active?.health ?? "unknown"}</Badge>
              }
            />
            <DetailRow
              label="Status"
              value={
                <Badge variant={statusVariant(active?.status)}>{active?.status ?? "unknown"}</Badge>
              }
            />
            <DetailRow label="Runtime" value={activeState} />
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Port Mappings" badge={deployment.routes.length}>
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {deployment.routes.map((route) => (
              <DetailRow
                key={route.id}
                label={`0.0.0.0:${route.hostPort}`}
                value={
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">tcp/{route.containerPort}</span>
                    {route.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  </span>
                }
              />
            ))}
          </div>
        </Section>

        <Section title="Health Check">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Path"
              value={<span className="font-mono">{deployment.healthConfig.path}</span>}
            />
            <DetailRow
              label="Status"
              value={
                <span className="font-mono">
                  {deployment.healthConfig.statusMin}-{deployment.healthConfig.statusMax}
                </span>
              }
            />
            <DetailRow label="Interval" value={`${deployment.healthConfig.intervalSeconds}s`} />
            <DetailRow label="Timeout" value={`${deployment.healthConfig.timeoutSeconds}s`} />
            <DetailRow label="Drain" value={`${deployment.drainSeconds}s`} />
            <DetailRow
              label="Primary"
              value={
                <span className="font-mono">
                  {primaryRoute ? `${primaryRoute.hostPort} -> ${primaryRoute.containerPort}` : "-"}
                </span>
              }
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function DeploymentSlots({
  deployment,
  nodeId,
  action,
  serviceBusy,
  runAction,
  canManage,
}: {
  deployment: DockerDeployment;
  nodeId: string;
  action: string | null;
  serviceBusy: boolean;
  runAction: (name: string, fn: () => Promise<void>) => Promise<void>;
  canManage: boolean;
}) {
  const orderedSlots = (["blue", "green"] as const)
    .map((slotName) => deployment.slots.find((slot) => slot.slot === slotName))
    .filter((slot): slot is DockerDeploymentSlot => Boolean(slot));

  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {orderedSlots.map((slot) => {
          const desiredImage = deployment.desiredConfig.image;
          const effectiveImage =
            slot.slot === deployment.activeSlot ? (slot.image ?? desiredImage) : desiredImage;

          return (
            <Section
              key={slot.slot}
              title={`${slot.slot[0].toUpperCase()}${slot.slot.slice(1)} Slot`}
              active={slot.slot === deployment.activeSlot}
              actions={
                canManage && slot.slot !== deployment.activeSlot ? (
                  <Button
                    size="sm"
                    disabled={!!action || serviceBusy || !slot.containerId}
                    onClick={() =>
                      runAction(`switch-${slot.slot}`, async () => {
                        await api.switchDockerDeployment(nodeId, deployment.id, slot.slot);
                        toast.success("Switched active slot");
                      })
                    }
                  >
                    Switch
                  </Button>
                ) : null
              }
            >
              <div className="divide-y divide-border -mb-px">
                <DetailRow
                  label="Role"
                  value={
                    <div className="flex justify-end gap-2">
                      {slot.slot === deployment.activeSlot && <Badge>Active</Badge>}
                      {slot.status === "draining" && <Badge variant="warning">Draining</Badge>}
                      {slot.slot !== deployment.activeSlot && slot.status !== "draining" && (
                        <Badge variant="secondary">Standby</Badge>
                      )}
                    </div>
                  }
                />
                <DetailRow
                  label="Status"
                  value={<Badge variant={statusVariant(slot.status)}>{slot.status}</Badge>}
                />
                <DetailRow
                  label="Health"
                  value={<Badge variant={statusVariant(slot.health)}>{slot.health}</Badge>}
                />
                <div
                  className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-4 border-b border-border px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)]"
                  style={
                    slot.slot === deployment.activeSlot ? { borderBottomColor: "#fff" } : undefined
                  }
                >
                  <span className="pt-0.5 text-sm text-muted-foreground">Image</span>
                  <span className="min-w-0 justify-self-end text-right text-sm">
                    <span className="font-mono break-all">{effectiveImage}</span>
                  </span>
                </div>
              </div>
            </Section>
          );
        })}
      </div>

      <Section title="Recent Activity" badge={deployment.releases.length}>
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
          {deployment.releases.map((release) => (
            <ReleaseRow key={release.id} release={release} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function ReleaseRow({ release }: { release: DockerDeploymentRelease }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm capitalize">{release.triggerSource}</span>
          <span className="inline-flex min-w-0 items-center text-sm text-muted-foreground">
            {release.fromSlot ?? "-"}
            <ArrowRight className="mx-1.5 h-3.5 w-3.5 shrink-0" />
            {release.toSlot ?? "-"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">{release.image ?? "-"}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <Badge variant={statusVariant(release.status)}>{release.status}</Badge>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDate(release.createdAt)}
        </span>
      </div>
    </div>
  );
}

function DeploymentSettings({
  deployment,
  nodeId,
  action,
  webhook,
  setWebhook,
  onHealthCheckSaved,
  canEditMounts,
  canManageWebhooks,
  runAction,
}: {
  deployment: DockerDeployment;
  nodeId: string;
  action: string | null;
  webhook: DockerWebhook | null;
  setWebhook: (webhook: DockerWebhook | null) => void;
  onHealthCheckSaved: (healthCheck: DockerHealthCheck) => void;
  canEditMounts: boolean;
  canManageWebhooks: boolean;
  runAction: (name: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const initialEntrypoint = useMemo(
    () => ((deployment.desiredConfig as any).entrypoint ?? []).join(" "),
    [deployment.desiredConfig]
  );
  const initialCommand = useMemo(
    () => ((deployment.desiredConfig as any).command ?? []).join(" "),
    [deployment.desiredConfig]
  );
  const initialWorkingDir = (deployment.desiredConfig as any).workingDir ?? "";
  const initialUser = (deployment.desiredConfig as any).user ?? "";
  const initialPorts = useMemo(
    () =>
      deployment.routes.map((route) => ({
        hostPort: String(route.hostPort),
        containerPort: String(route.containerPort),
        protocol: "tcp" as const,
      })),
    [deployment.routes]
  );
  const initialReadinessRouteIndex = useMemo(() => {
    const index = deployment.routes.findIndex((route) => route.isPrimary);
    return index >= 0 ? index : 0;
  }, [deployment.routes]);
  const initialMounts = useMemo(
    () => normalizeMounts((deployment.desiredConfig as any).mounts),
    [deployment.desiredConfig]
  );
  const initialLabels = useMemo(
    () => normalizeLabels((deployment.desiredConfig as any).labels),
    [deployment.desiredConfig]
  );
  const runtime = ((deployment.desiredConfig as any).runtime ?? {}) as Record<string, any>;
  const desiredImageParts = useMemo(
    () => splitImageRef(deployment.desiredConfig.image),
    [deployment.desiredConfig.image]
  );
  const deploymentBaseline = useMemo(
    () => ({
      imageName: desiredImageParts.imageName,
      imageTag: desiredImageParts.tag,
      entrypoint: initialEntrypoint,
      command: initialCommand,
      workingDir: initialWorkingDir,
      user: initialUser,
      ports: JSON.stringify(initialPorts),
      readinessRouteIndex: initialReadinessRouteIndex,
      mounts: JSON.stringify(initialMounts),
      labels: JSON.stringify(initialLabels),
      restartPolicy: deployment.desiredConfig.restartPolicy ?? "unless-stopped",
      maxRetries: String(runtime.maxRetries ?? 0),
      memoryMB: runtime.memoryMB ? String(runtime.memoryMB) : "",
      memSwapMB: runtime.memSwapMB ? String(runtime.memSwapMB) : "",
      cpuCount: runtime.cpuCount ? String(runtime.cpuCount) : "",
      cpuShares: runtime.cpuShares ? String(runtime.cpuShares) : "",
      pidsLimit: runtime.pidsLimit ? String(runtime.pidsLimit) : "",
      drainSeconds: String(deployment.drainSeconds),
    }),
    [
      deployment.desiredConfig.restartPolicy,
      deployment.drainSeconds,
      desiredImageParts.imageName,
      desiredImageParts.tag,
      initialCommand,
      initialEntrypoint,
      initialLabels,
      initialMounts,
      initialPorts,
      initialReadinessRouteIndex,
      initialUser,
      initialWorkingDir,
      runtime.cpuCount,
      runtime.cpuShares,
      runtime.maxRetries,
      runtime.memSwapMB,
      runtime.memoryMB,
      runtime.pidsLimit,
    ]
  );
  const [imageTag, setImageTag] = useState(desiredImageParts.tag);
  const [entrypoint, setEntrypoint] = useState(initialEntrypoint);
  const [command, setCommand] = useState(initialCommand);
  const [workingDir, setWorkingDir] = useState(initialWorkingDir);
  const [user, setUser] = useState(initialUser);
  const [ports, setPorts] = useState<PortMapping[]>(initialPorts);
  const [readinessRouteIndex, setReadinessRouteIndex] = useState(initialReadinessRouteIndex);
  const [mounts, setMounts] = useState<MountEntry[]>(initialMounts);
  const [labels, setLabels] = useState<Array<{ key: string; value: string }>>(initialLabels);
  const [restartPolicy, setRestartPolicy] = useState(
    deployment.desiredConfig.restartPolicy ?? "unless-stopped"
  );
  const [maxRetries, setMaxRetries] = useState(String(runtime.maxRetries ?? 0));
  const [memoryMB, setMemoryMB] = useState(runtime.memoryMB ? String(runtime.memoryMB) : "");
  const [memSwapMB, setMemSwapMB] = useState(runtime.memSwapMB ? String(runtime.memSwapMB) : "");
  const [cpuCount, setCpuCount] = useState(runtime.cpuCount ? String(runtime.cpuCount) : "");
  const [cpuShares, setCpuShares] = useState(runtime.cpuShares ? String(runtime.cpuShares) : "");
  const [pidsLimit, setPidsLimit] = useState(runtime.pidsLimit ? String(runtime.pidsLimit) : "");
  const [drainSeconds, setDrainSeconds] = useState(String(deployment.drainSeconds));
  const [runtimeCapacity, setRuntimeCapacity] = useState<DockerRuntimeCapacity>(
    UNKNOWN_DOCKER_RUNTIME_CAPACITY
  );
  const previousDeploymentBaselineRef = useRef(deploymentBaseline);
  const inputCell =
    "h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  useEffect(() => {
    let cancelled = false;
    void loadDockerRuntimeCapacity(nodeId).then((capacity) => {
      if (!cancelled) setRuntimeCapacity(capacity);
    });

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => {
    const previous = previousDeploymentBaselineRef.current;
    const formMatchesPrevious =
      imageTag === previous.imageTag &&
      entrypoint === previous.entrypoint &&
      command === previous.command &&
      workingDir === previous.workingDir &&
      user === previous.user &&
      JSON.stringify(ports) === previous.ports &&
      readinessRouteIndex === previous.readinessRouteIndex &&
      JSON.stringify(mounts) === previous.mounts &&
      JSON.stringify(labels) === previous.labels &&
      restartPolicy === previous.restartPolicy &&
      maxRetries === previous.maxRetries &&
      memoryMB === previous.memoryMB &&
      memSwapMB === previous.memSwapMB &&
      cpuCount === previous.cpuCount &&
      cpuShares === previous.cpuShares &&
      pidsLimit === previous.pidsLimit &&
      drainSeconds === previous.drainSeconds;

    previousDeploymentBaselineRef.current = deploymentBaseline;

    if (!formMatchesPrevious) return;
    setImageTag(deploymentBaseline.imageTag);
    setEntrypoint(deploymentBaseline.entrypoint);
    setCommand(deploymentBaseline.command);
    setWorkingDir(deploymentBaseline.workingDir);
    setUser(deploymentBaseline.user);
    setPorts(initialPorts);
    setReadinessRouteIndex(deploymentBaseline.readinessRouteIndex);
    setMounts(initialMounts);
    setLabels(initialLabels);
    setRestartPolicy(deploymentBaseline.restartPolicy);
    setMaxRetries(deploymentBaseline.maxRetries);
    setMemoryMB(deploymentBaseline.memoryMB);
    setMemSwapMB(deploymentBaseline.memSwapMB);
    setCpuCount(deploymentBaseline.cpuCount);
    setCpuShares(deploymentBaseline.cpuShares);
    setPidsLimit(deploymentBaseline.pidsLimit);
    setDrainSeconds(deploymentBaseline.drainSeconds);
  }, [
    command,
    cpuCount,
    cpuShares,
    deploymentBaseline,
    drainSeconds,
    entrypoint,
    imageTag,
    initialLabels,
    initialMounts,
    initialPorts,
    labels,
    maxRetries,
    memoryMB,
    memSwapMB,
    mounts,
    pidsLimit,
    ports,
    readinessRouteIndex,
    restartPolicy,
    user,
    workingDir,
  ]);

  const nextImage = joinImageRef(deploymentBaseline.imageName, imageTag);
  const imageTagLocked = deploymentBaseline.imageName.includes("@");
  const executionChanged =
    nextImage !== deployment.desiredConfig.image ||
    entrypoint !== initialEntrypoint ||
    command !== initialCommand ||
    workingDir !== initialWorkingDir ||
    user !== initialUser;
  const portsChanged = JSON.stringify(ports) !== JSON.stringify(initialPorts);
  const selectedReadinessRouteIndex =
    ports.length > 0 ? Math.min(readinessRouteIndex, ports.length - 1) : 0;
  const mountsChanged = JSON.stringify(mounts) !== JSON.stringify(initialMounts);
  const labelsChanged = JSON.stringify(labels) !== JSON.stringify(initialLabels);
  const drainChanged = drainSeconds !== String(deployment.drainSeconds);
  const settingsChanged =
    executionChanged || portsChanged || mountsChanged || labelsChanged || drainChanged;
  const executionCardChanged = executionChanged || drainChanged;
  const runtimeChanged =
    restartPolicy !== (deployment.desiredConfig.restartPolicy ?? "unless-stopped") ||
    maxRetries !== String(runtime.maxRetries ?? 0) ||
    memoryMB !== (runtime.memoryMB ? String(runtime.memoryMB) : "") ||
    memSwapMB !== (runtime.memSwapMB ? String(runtime.memSwapMB) : "") ||
    cpuCount !== (runtime.cpuCount ? String(runtime.cpuCount) : "") ||
    cpuShares !== (runtime.cpuShares ? String(runtime.cpuShares) : "") ||
    pidsLimit !== (runtime.pidsLimit ? String(runtime.pidsLimit) : "");

  const runtimeValidationError = useMemo(() => {
    const parsedMemoryMB = parseOptionalNumber(memoryMB);
    if (Number.isNaN(parsedMemoryMB) || (parsedMemoryMB !== null && parsedMemoryMB < 0)) {
      return "Memory limit must be a non-negative number.";
    }

    const parsedSwapMB = memSwapMB === "-1" ? -1 : parseOptionalNumber(memSwapMB);
    if (
      Number.isNaN(parsedSwapMB) ||
      (parsedSwapMB !== null && parsedSwapMB !== -1 && parsedSwapMB < 0)
    ) {
      return "Swap must be -1 or a non-negative number.";
    }

    const parsedCpuCount = parseOptionalNumber(cpuCount);
    if (Number.isNaN(parsedCpuCount) || (parsedCpuCount !== null && parsedCpuCount < 0)) {
      return "CPU limit must be a non-negative number.";
    }

    if ((parsedSwapMB === -1 || (parsedSwapMB ?? 0) > 0) && !parsedMemoryMB) {
      return "Set a memory limit before configuring swap.";
    }

    const maxMemoryMB =
      runtimeCapacity.maxMemoryBytes && runtimeCapacity.maxMemoryBytes > 0
        ? runtimeCapacity.maxMemoryBytes / 1048576
        : null;
    if (maxMemoryMB && parsedMemoryMB !== null && parsedMemoryMB > maxMemoryMB) {
      return `Memory limit cannot exceed node memory (${formatBytes(runtimeCapacity.maxMemoryBytes ?? 0)}).`;
    }

    const maxSwapMB =
      runtimeCapacity.maxSwapBytes !== null && runtimeCapacity.maxSwapBytes >= 0
        ? runtimeCapacity.maxSwapBytes / 1048576
        : null;
    if (
      maxSwapMB !== null &&
      parsedSwapMB !== null &&
      parsedSwapMB !== -1 &&
      parsedSwapMB > maxSwapMB
    ) {
      return `Swap cannot exceed node swap (${formatBytes(runtimeCapacity.maxSwapBytes ?? 0)}).`;
    }

    if (
      runtimeCapacity.maxCpuCount &&
      parsedCpuCount !== null &&
      parsedCpuCount > runtimeCapacity.maxCpuCount
    ) {
      return `CPU limit cannot exceed node CPU capacity (${runtimeCapacity.maxCpuCount} cores).`;
    }

    return null;
  }, [cpuCount, memSwapMB, memoryMB, runtimeCapacity]);

  return (
    <div className="space-y-6 pb-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RuntimeSection
          canEdit
          appliesLive={false}
          restartPolicy={restartPolicy}
          setRestartPolicy={setRestartPolicy}
          maxRetries={maxRetries}
          setMaxRetries={setMaxRetries}
          memoryMB={memoryMB}
          setMemoryMB={setMemoryMB}
          memSwapMB={memSwapMB}
          setMemSwapMB={setMemSwapMB}
          cpuCount={cpuCount}
          setCpuCount={setCpuCount}
          cpuShares={cpuShares}
          setCpuShares={setCpuShares}
          pidsLimit={pidsLimit}
          setPidsLimit={setPidsLimit}
          maxMemoryBytes={runtimeCapacity.maxMemoryBytes}
          maxSwapBytes={runtimeCapacity.maxSwapBytes}
          maxCpuCount={runtimeCapacity.maxCpuCount}
          runtimeValidationError={runtimeValidationError}
          hasRuntimeChanges={runtimeChanged}
          liveLoading={!!action}
          onApply={() =>
            runAction("update-runtime", async () => {
              await api.updateDockerDeployment(nodeId, deployment.id, {
                desiredConfig: {
                  restartPolicy,
                  runtime: { maxRetries, memoryMB, memSwapMB, cpuCount, cpuShares, pidsLimit },
                },
              });
              toast.success("Runtime settings updated");
            })
          }
        />

        <div
          className="border bg-card overflow-hidden"
          style={executionCardChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Execution</h3>
              <p className="text-xs text-muted-foreground">Saved to deployment configuration</p>
            </div>
            <Button
              size="sm"
              style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
              className="hover:opacity-90 disabled:opacity-50"
              disabled={!!action || !settingsChanged || !nextImage.trim()}
              onClick={() =>
                runAction("update-execution", async () => {
                  const labelMap: Record<string, string> = {};
                  for (const label of labels) {
                    if (label.key.trim()) labelMap[label.key.trim()] = label.value;
                  }
                  await api.updateDockerDeployment(nodeId, deployment.id, {
                    desiredConfig: {
                      image: nextImage,
                      entrypoint: entrypoint.trim() ? entrypoint.trim().split(/\s+/) : [],
                      command: command.trim() ? command.trim().split(/\s+/) : [],
                      workingDir,
                      user,
                      mounts,
                      labels: labelMap,
                    },
                    routes: ports
                      .filter((port) => port.hostPort && port.containerPort)
                      .map((port, index) => ({
                        hostPort: Number(port.hostPort),
                        containerPort: Number(port.containerPort),
                        isPrimary: index === selectedReadinessRouteIndex,
                      })),
                    drainSeconds: Number(drainSeconds),
                  });
                  toast.success("Service configuration updated");
                })
              }
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Image</label>
                <Input
                  className="h-8 text-xs font-mono bg-muted/50"
                  value={deploymentBaseline.imageName}
                  disabled
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tag</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={imageTag}
                  onChange={(e) => setImageTag(e.target.value)}
                  placeholder={imageTagLocked ? "digest" : "latest"}
                  disabled={imageTagLocked}
                  style={
                    nextImage !== deployment.desiredConfig.image
                      ? { borderColor: "rgb(234 179 8)" }
                      : undefined
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Drain Seconds</label>
                <Input
                  className="h-8 text-xs"
                  inputMode="numeric"
                  value={drainSeconds}
                  onChange={(event) => setDrainSeconds(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Entrypoint</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                  placeholder="/docker-entrypoint.sh"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Working Directory
                </label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/app"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">User</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="root"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Command</label>
              <Input
                className="h-8 text-xs font-mono"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="nginx -g daemon off;"
              />
            </div>
          </div>
        </div>
      </div>

      <PortMappingsSection
        canEdit
        ports={ports}
        setPorts={setPorts}
        portsChanged={portsChanged}
        inputCell={inputCell}
        showProtocol={false}
      />

      <VolumeMountsSection
        canEdit={canEditMounts}
        mounts={mounts}
        setMounts={setMounts}
        mountsChanged={mountsChanged}
        inputCell={inputCell}
      />

      <LabelsSection
        canEdit
        labels={labels}
        setLabels={setLabels}
        labelsChanged={labelsChanged}
        inputCell={inputCell}
      />

      <DockerHealthCheckSection
        nodeId={nodeId}
        target="deployment"
        deploymentId={deployment.id}
        initialHealthCheck={deployment.healthCheck ?? null}
        disabled={!!action}
        onSaved={onHealthCheckSaved}
      />

      <WebhookSection
        nodeId={nodeId}
        target="deployment"
        deploymentId={deployment.id}
        initialWebhook={webhook}
        onWebhookChange={setWebhook}
        disabled={!!action}
        allowWebhook={canManageWebhooks}
        allowCleanup
      />
    </div>
  );
}

function DeploymentConfig({ deployment }: { deployment: DockerDeployment }) {
  const jsonText = useMemo(
    () =>
      JSON.stringify(
        {
          id: deployment.id,
          name: deployment.name,
          status: deployment.status,
          activeSlot: deployment.activeSlot,
          desiredConfig: deployment.desiredConfig,
          routes: deployment.routes,
          healthConfig: deployment.healthConfig,
          drainSeconds: deployment.drainSeconds,
          routerName: deployment.routerName,
          routerImage: deployment.routerImage,
          networkName: deployment.networkName,
          slots: deployment.slots.map((slot) => ({
            slot: slot.slot,
            image: slot.image,
            status: slot.status,
            health: slot.health,
            drainingUntil: slot.drainingUntil,
            updatedAt: slot.updatedAt,
          })),
        },
        null,
        2
      ),
    [deployment]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border border-border border-b-0 bg-card">
          <div>
            <h3 className="text-sm font-semibold">Deployment Config</h3>
            <p className="text-xs text-muted-foreground">Service-level configuration</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => copyToClipboard(jsonText)}
            title="Copy JSON"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <CodeEditor value={jsonText} onChange={() => {}} readOnly language="json" />
        </div>
      </div>
    </div>
  );
}
