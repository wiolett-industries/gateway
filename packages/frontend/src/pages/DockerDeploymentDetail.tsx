import {
  ArrowLeft,
  ArrowRight,
  ClipboardCopy,
  Code2,
  EllipsisVertical,
  Play,
  RotateCcw,
  Save,
  Settings,
  Skull,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { DetailRow } from "@/components/common/DetailRow";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useUrlTab } from "@/hooks/use-url-tab";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  DockerDeployment,
  DockerDeploymentRelease,
  DockerDeploymentSlot,
  DockerWebhook,
} from "@/types";
import { ConsoleTab } from "./docker-detail/ConsoleTab";
import { EnvironmentTab } from "./docker-detail/EnvironmentTab";
import { FilesTab } from "./docker-detail/FilesTab";
import {
  copyToClipboard,
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
  const navigate = useNavigate();
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

  const [deployment, setDeployment] = useState<DockerDeployment | null>(null);
  const [activeInspect, setActiveInspect] = useState<InspectData | null>(null);
  const [webhook, setWebhook] = useState<DockerWebhook | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);

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
  }, [deploymentId, navigate, nodeId]);

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

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${
          isTerminalTab ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/docker")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{deployment.name}</h1>
                <Badge variant={statusVariant(serviceState)}>{serviceState}</Badge>
                <Badge variant="outline">blue/green</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {active?.image ?? deployment.desiredConfig.image} &middot; active{" "}
                {deployment.activeSlot}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isStopped && canManage && (
              <Button
                variant="outline"
                disabled={!!action || serviceBusy}
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
                  disabled={!!action || serviceBusy}
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
                  disabled={!!action || serviceBusy}
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
                <Button variant="outline" size="icon" disabled={!!action || serviceBusy}>
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
          </div>
        </div>

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
                runAction={runAction}
              />
            </TabsContent>
          )}
          <TabsContent value="config" className="flex flex-col flex-1 min-h-0 pb-0">
            <DeploymentConfig deployment={deployment} />
          </TabsContent>
        </Tabs>
      </div>
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
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm capitalize">{release.triggerSource}</span>
          <span className="text-sm text-muted-foreground">
            {release.fromSlot ?? "-"}
            <ArrowRight className="mx-1.5 inline h-3.5 w-3.5 align-[-2px]" />
            {release.toSlot ?? "-"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">{release.image ?? "-"}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={statusVariant(release.status)}>{release.status}</Badge>
        <span className="text-sm text-muted-foreground">{formatDate(release.createdAt)}</span>
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
  runAction,
}: {
  deployment: DockerDeployment;
  nodeId: string;
  action: string | null;
  webhook: DockerWebhook | null;
  setWebhook: (webhook: DockerWebhook | null) => void;
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
  const [image, setImage] = useState(deployment.desiredConfig.image);
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
  const runtime = ((deployment.desiredConfig as any).runtime ?? {}) as Record<string, any>;
  const [maxRetries, setMaxRetries] = useState(String(runtime.maxRetries ?? 0));
  const [memoryMB, setMemoryMB] = useState(runtime.memoryMB ? String(runtime.memoryMB) : "");
  const [memSwapMB, setMemSwapMB] = useState(runtime.memSwapMB ? String(runtime.memSwapMB) : "");
  const [cpuCount, setCpuCount] = useState(runtime.cpuCount ? String(runtime.cpuCount) : "");
  const [cpuShares, setCpuShares] = useState(runtime.cpuShares ? String(runtime.cpuShares) : "");
  const [pidsLimit, setPidsLimit] = useState(runtime.pidsLimit ? String(runtime.pidsLimit) : "");
  const [healthPath, setHealthPath] = useState(deployment.healthConfig.path);
  const [statusMin, setStatusMin] = useState(String(deployment.healthConfig.statusMin));
  const [statusMax, setStatusMax] = useState(String(deployment.healthConfig.statusMax));
  const [intervalSeconds, setIntervalSeconds] = useState(
    String(deployment.healthConfig.intervalSeconds)
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(deployment.healthConfig.timeoutSeconds)
  );
  const [drainSeconds, setDrainSeconds] = useState(String(deployment.drainSeconds));
  const inputCell =
    "h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  const executionChanged =
    image !== deployment.desiredConfig.image ||
    entrypoint !== initialEntrypoint ||
    command !== initialCommand ||
    workingDir !== initialWorkingDir ||
    user !== initialUser;
  const portsChanged = JSON.stringify(ports) !== JSON.stringify(initialPorts);
  const selectedReadinessRouteIndex =
    ports.length > 0 ? Math.min(readinessRouteIndex, ports.length - 1) : 0;
  const readinessRouteChanged = selectedReadinessRouteIndex !== initialReadinessRouteIndex;
  const mountsChanged = JSON.stringify(mounts) !== JSON.stringify(initialMounts);
  const labelsChanged = JSON.stringify(labels) !== JSON.stringify(initialLabels);
  const settingsChanged = executionChanged || portsChanged || mountsChanged || labelsChanged;
  const runtimeChanged =
    restartPolicy !== (deployment.desiredConfig.restartPolicy ?? "unless-stopped") ||
    maxRetries !== String(runtime.maxRetries ?? 0) ||
    memoryMB !== (runtime.memoryMB ? String(runtime.memoryMB) : "") ||
    memSwapMB !== (runtime.memSwapMB ? String(runtime.memSwapMB) : "") ||
    cpuCount !== (runtime.cpuCount ? String(runtime.cpuCount) : "") ||
    cpuShares !== (runtime.cpuShares ? String(runtime.cpuShares) : "") ||
    pidsLimit !== (runtime.pidsLimit ? String(runtime.pidsLimit) : "");
  const healthChanged =
    healthPath !== deployment.healthConfig.path ||
    statusMin !== String(deployment.healthConfig.statusMin) ||
    statusMax !== String(deployment.healthConfig.statusMax) ||
    intervalSeconds !== String(deployment.healthConfig.intervalSeconds) ||
    timeoutSeconds !== String(deployment.healthConfig.timeoutSeconds) ||
    drainSeconds !== String(deployment.drainSeconds) ||
    readinessRouteChanged;

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
          maxMemoryBytes={null}
          maxSwapBytes={null}
          maxCpuCount={null}
          runtimeValidationError={null}
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
          style={executionChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
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
              disabled={!!action || !settingsChanged || !image.trim()}
              onClick={() =>
                runAction("update-execution", async () => {
                  const labelMap: Record<string, string> = {};
                  for (const label of labels) {
                    if (label.key.trim()) labelMap[label.key.trim()] = label.value;
                  }
                  await api.updateDockerDeployment(nodeId, deployment.id, {
                    desiredConfig: {
                      image: image.trim(),
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
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Image</label>
              <Input
                className="h-8 text-xs font-mono"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="nginx:alpine"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">User</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="root"
                />
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
        canEdit
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

      <div
        className="border border-border bg-card overflow-hidden"
        style={healthChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Health Check</h3>
            <p className="text-xs text-muted-foreground">Saved to deployment configuration</p>
          </div>
          <Button
            size="sm"
            disabled={!!action || !healthChanged}
            onClick={() =>
              runAction("update-health", async () => {
                await api.updateDockerDeployment(nodeId, deployment.id, {
                  health: {
                    ...deployment.healthConfig,
                    path: healthPath || "/",
                    statusMin: Number(statusMin),
                    statusMax: Number(statusMax),
                    intervalSeconds: Number(intervalSeconds),
                    timeoutSeconds: Number(timeoutSeconds),
                  },
                  drainSeconds: Number(drainSeconds),
                  routes: ports
                    .filter((port) => port.hostPort && port.containerPort)
                    .map((port, index) => ({
                      hostPort: Number(port.hostPort),
                      containerPort: Number(port.containerPort),
                      isPrimary: index === selectedReadinessRouteIndex,
                    })),
                });
                toast.success("Health settings updated");
              })
            }
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Readiness Route</label>
              <Select
                value={String(selectedReadinessRouteIndex)}
                onValueChange={(value) => setReadinessRouteIndex(Number(value))}
                disabled={ports.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ports.map((port, index) => (
                    <SelectItem key={index} value={String(index)}>
                      <span className="inline-flex items-center">
                        {port.hostPort || "-"}
                        <ArrowRight className="mx-1.5 h-3.5 w-3.5" />
                        {port.containerPort || "-"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Health Path</label>
              <Input
                className="h-8 text-xs"
                value={healthPath}
                onChange={(e) => setHealthPath(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status Min</label>
              <Input
                className="h-8 text-xs"
                inputMode="numeric"
                value={statusMin}
                onChange={(e) => setStatusMin(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status Max</label>
              <Input
                className="h-8 text-xs"
                inputMode="numeric"
                value={statusMax}
                onChange={(e) => setStatusMax(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Interval Seconds</label>
              <Input
                className="h-8 text-xs"
                inputMode="numeric"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Timeout Seconds</label>
              <Input
                className="h-8 text-xs"
                inputMode="numeric"
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Drain Seconds</label>
              <Input
                className="h-8 text-xs"
                inputMode="numeric"
                value={drainSeconds}
                onChange={(e) => setDrainSeconds(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <WebhookSection
        nodeId={nodeId}
        target="deployment"
        deploymentId={deployment.id}
        initialWebhook={webhook}
        onWebhookChange={setWebhook}
        disabled={!!action}
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
