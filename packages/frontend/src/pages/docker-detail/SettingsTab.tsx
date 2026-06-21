import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { DockerHealthCheckSection } from "@/components/docker/DockerHealthCheckSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type DockerRuntimeCapacity,
  loadDockerRuntimeCapacity,
  UNKNOWN_DOCKER_RUNTIME_CAPACITY,
} from "@/lib/docker-runtime-capacity";
import { formatBytes } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerHealthCheck } from "@/types";
import type { InspectData } from "./helpers";
import { LabelsSection } from "./LabelsSection";
import { NetworksSection } from "./NetworksSection";
import { type PortMapping, PortMappingsSection } from "./PortMappingsSection";
import { RuntimeSection } from "./RuntimeSection";
import { buildRuntimePayloadFromForm, type RuntimeFormValues } from "./runtime-payload";
import { buildRecreatePayloadFromForm, type RecreateBaseline } from "./settings-payload";
import { type MountEntry, VolumeMountsSection } from "./VolumeMountsSection";
import { WebhookSection } from "./WebhookSection";

export { buildRecreatePayloadFromForm } from "./settings-payload";
export { WebhookSection } from "./WebhookSection";

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function sameRuntimeBaseline(a: RuntimeFormValues, b: RuntimeFormValues) {
  return (
    a.restartPolicy === b.restartPolicy &&
    a.maxRetries === b.maxRetries &&
    a.memoryMB === b.memoryMB &&
    a.memSwapMB === b.memSwapMB &&
    a.cpuCount === b.cpuCount &&
    a.cpuShares === b.cpuShares &&
    a.pidsLimit === b.pidsLimit
  );
}

function sameRecreateBaseline(a: RecreateBaseline, b: RecreateBaseline) {
  return (
    a.imageTag === b.imageTag &&
    a.ports === b.ports &&
    a.mounts === b.mounts &&
    a.entrypoint === b.entrypoint &&
    a.command === b.command &&
    a.stopTimeout === b.stopTimeout &&
    a.workingDir === b.workingDir &&
    a.user === b.user &&
    a.hostname === b.hostname &&
    a.labels === b.labels
  );
}

function deriveCurrentNanoCPUs(hostConfig: Record<string, any>): number {
  const nanoCPUs = Number(hostConfig.NanoCPUs ?? 0);
  if (Number.isFinite(nanoCPUs) && nanoCPUs > 0) return nanoCPUs;

  const cpuQuota = Number(hostConfig.CPUQuota ?? 0);
  const cpuPeriod = Number(hostConfig.CPUPeriod ?? 0);
  if (Number.isFinite(cpuQuota) && Number.isFinite(cpuPeriod) && cpuQuota > 0 && cpuPeriod > 0) {
    return Math.round((cpuQuota / cpuPeriod) * 1e9);
  }

  return 0;
}

// ── Component ────────────────────────────────────────────────────

export function SettingsTab({
  nodeId,
  containerId,
  data,
  onMutationStart,
  onMutationEnd,
  onRecreating,
  onRefresh,
  onHealthCheckSaved,
  transition,
}: {
  nodeId: string;
  containerId: string;
  data: InspectData;
  onMutationStart?: (transition: "updating" | "recreating") => void;
  onMutationEnd?: () => void;
  onRecreating?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onHealthCheckSaved?: (healthCheck: DockerHealthCheck) => void;
  transition?: string;
}) {
  const { hasScope } = useAuthStore();
  const invalidate = useDockerStore((s) => s.invalidate);
  const canEdit =
    hasScope("docker:containers:edit") || hasScope(`docker:containers:edit:${nodeId}`);
  const canEditMounts =
    hasScope("docker:containers:mounts") || hasScope(`docker:containers:mounts:${nodeId}`);
  const canManageNetworks = hasScope("docker:networks:edit");
  const canListNetworks = hasScope("docker:networks:view");
  const recreatesRunningContainer =
    (data.State?.Status ?? (data.State?.Running ? "running" : "stopped")) === "running";

  // ── Live settings state (no recreation) ──
  const hostConfig = data.HostConfig ?? {};
  const currentRestartPolicy = hostConfig.RestartPolicy?.Name ?? "no";
  const currentMaxRetries = hostConfig.RestartPolicy?.MaximumRetryCount ?? 0;
  const currentMemory = hostConfig.Memory ?? 0;
  const currentMemSwap = hostConfig.MemorySwap ?? 0;
  const currentNanoCPUs = deriveCurrentNanoCPUs(hostConfig as Record<string, any>);
  const currentCpuShares = hostConfig.CpuShares ?? 0;
  const currentPidsLimit = hostConfig.PidsLimit ?? 0;

  const initMem = currentMemory > 0 ? String(Math.round(currentMemory / 1048576)) : "";
  const currentSwap =
    currentMemSwap === -1
      ? -1
      : currentMemSwap > 0
        ? Math.max(0, currentMemSwap - currentMemory)
        : 0;
  const initSwap =
    currentSwap === -1 ? "-1" : currentSwap > 0 ? String(Math.round(currentSwap / 1048576)) : "";
  const initCpu = currentNanoCPUs > 0 ? String(currentNanoCPUs / 1e9) : "";
  const initShares = currentCpuShares > 0 ? String(currentCpuShares) : "";
  const initPids = currentPidsLimit > 0 ? String(currentPidsLimit) : "";

  const runtimeServerBaseline: RuntimeFormValues = useMemo(
    () => ({
      restartPolicy: currentRestartPolicy,
      maxRetries: String(currentMaxRetries),
      memoryMB: initMem,
      memSwapMB: initSwap,
      cpuCount: initCpu,
      cpuShares: initShares,
      pidsLimit: initPids,
    }),
    [currentRestartPolicy, currentMaxRetries, initMem, initSwap, initCpu, initShares, initPids]
  );

  const [restartPolicy, setRestartPolicy] = useState(runtimeServerBaseline.restartPolicy);
  const [maxRetries, setMaxRetries] = useState(runtimeServerBaseline.maxRetries);
  const [memoryMB, setMemoryMB] = useState(runtimeServerBaseline.memoryMB);
  const [memSwapMB, setMemSwapMB] = useState(runtimeServerBaseline.memSwapMB);
  const [cpuCount, setCpuCount] = useState(runtimeServerBaseline.cpuCount);
  const [cpuShares, setCpuShares] = useState(runtimeServerBaseline.cpuShares);
  const [pidsLimit, setPidsLimit] = useState(runtimeServerBaseline.pidsLimit);
  const [liveLoading, setLiveLoading] = useState(false);
  const [runtimeCapacity, setRuntimeCapacity] = useState<DockerRuntimeCapacity>(
    UNKNOWN_DOCKER_RUNTIME_CAPACITY
  );

  // Baseline snapshot — updated after successful live apply
  const baselineRef = useRef<RuntimeFormValues>(runtimeServerBaseline);
  const previousRuntimeServerBaselineRef = useRef<RuntimeFormValues>(runtimeServerBaseline);

  // ── Recreate settings state ──
  const portBindings = (hostConfig.PortBindings ?? {}) as Record<
    string,
    Array<{ HostIp: string; HostPort: string }> | null
  >;
  const initialPorts = useMemo(() => {
    const ports: PortMapping[] = [];
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      if (!bindings) continue;
      const [port, proto] = containerPort.split("/");
      for (const binding of bindings) {
        ports.push({
          hostPort: binding.HostPort ?? "",
          containerPort: port,
          protocol: (proto as "tcp" | "udp") ?? "tcp",
        });
      }
    }
    return ports;
  }, [portBindings]);

  const initialMounts = useMemo(
    () =>
      (
        (data.Mounts ?? []) as Array<{
          Type: string;
          Source: string;
          Destination: string;
          Name?: string;
          RW: boolean;
        }>
      ).map((mount) => ({
        hostPath: mount.Type === "bind" ? mount.Source : "",
        containerPath: mount.Destination,
        name: mount.Type === "volume" ? (mount.Name ?? mount.Source) : "",
        readOnly: !mount.RW,
      })),
    [data.Mounts]
  );

  const config = data.Config ?? {};
  const containerName = useMemo(
    () => ((data.Name ?? "") as string).replace(/^\//, ""),
    [data.Name]
  );
  const currentImage = (config.Image ?? "") as string;
  const { imageName: parsedImageName, tag: parsedTag } = useMemo(() => {
    if (currentImage.includes("@")) {
      return { imageName: currentImage, tag: "" };
    }
    const lastColon = currentImage.lastIndexOf(":");
    const lastSlash = currentImage.lastIndexOf("/");
    if (lastColon === -1 || lastSlash > lastColon) {
      return { imageName: currentImage, tag: "" };
    }
    return { imageName: currentImage.slice(0, lastColon), tag: currentImage.slice(lastColon + 1) };
  }, [currentImage]);

  const [imageTag, setImageTag] = useState(parsedTag);
  const imageTagChanged = imageTag !== parsedTag;
  const imageTagLocked = parsedImageName.includes("@");

  const initialEntrypoint = (config.Entrypoint ?? []) as string[];
  const initialCmd = (config.Cmd ?? []) as string[];
  const initialStopTimeout =
    typeof config.StopTimeout === "number" && Number.isFinite(config.StopTimeout)
      ? String(config.StopTimeout)
      : "20";
  const initialWorkdir = (config.WorkingDir ?? "") as string;
  const initialUser = (config.User ?? "") as string;
  const initialHostname = (config.Hostname ?? "") as string;
  const initialLabels = (config.Labels ?? {}) as Record<string, string>;

  const [ports, setPorts] = useState<PortMapping[]>(initialPorts);
  const [mounts, setMounts] = useState<MountEntry[]>(initialMounts);
  const [entrypoint, setEntrypoint] = useState(initialEntrypoint.join(" "));
  const [command, setCommand] = useState(initialCmd.join(" "));
  const [stopTimeout, setStopTimeout] = useState(initialStopTimeout);
  const [workingDir, setWorkingDir] = useState(initialWorkdir);
  const [user, setUser] = useState(initialUser);
  const [hostname, setHostname] = useState(initialHostname);
  const [labels, setLabels] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initialLabels).map(([key, value]) => ({ key, value }))
  );
  const [recreateLoading, setRecreateLoading] = useState(false);

  const recreateBaseline = useMemo(
    () => ({
      imageTag: parsedTag,
      ports: JSON.stringify(initialPorts),
      mounts: JSON.stringify(initialMounts),
      entrypoint: initialEntrypoint.join(" "),
      command: initialCmd.join(" "),
      stopTimeout: initialStopTimeout,
      workingDir: initialWorkdir,
      user: initialUser,
      hostname: initialHostname,
      labels: JSON.stringify(Object.entries(initialLabels).map(([k, v]) => ({ key: k, value: v }))),
    }),
    [
      initialCmd,
      initialEntrypoint,
      initialHostname,
      initialLabels,
      initialMounts,
      initialPorts,
      initialStopTimeout,
      initialUser,
      initialWorkdir,
      parsedTag,
    ]
  );
  const previousRecreateBaselineRef = useRef(recreateBaseline);

  useEffect(() => {
    const previous = previousRuntimeServerBaselineRef.current;
    const baselineChanged = !sameRuntimeBaseline(previous, runtimeServerBaseline);
    const formMatchesPrevious =
      restartPolicy === previous.restartPolicy &&
      maxRetries === previous.maxRetries &&
      memoryMB === previous.memoryMB &&
      memSwapMB === previous.memSwapMB &&
      cpuCount === previous.cpuCount &&
      cpuShares === previous.cpuShares &&
      pidsLimit === previous.pidsLimit;

    baselineRef.current = runtimeServerBaseline;
    previousRuntimeServerBaselineRef.current = runtimeServerBaseline;

    if (!baselineChanged || !formMatchesPrevious) return;
    setRestartPolicy(runtimeServerBaseline.restartPolicy);
    setMaxRetries(runtimeServerBaseline.maxRetries);
    setMemoryMB(runtimeServerBaseline.memoryMB);
    setMemSwapMB(runtimeServerBaseline.memSwapMB);
    setCpuCount(runtimeServerBaseline.cpuCount);
    setCpuShares(runtimeServerBaseline.cpuShares);
    setPidsLimit(runtimeServerBaseline.pidsLimit);
  }, [
    cpuCount,
    cpuShares,
    maxRetries,
    memoryMB,
    memSwapMB,
    pidsLimit,
    restartPolicy,
    runtimeServerBaseline,
  ]);

  useEffect(() => {
    const previous = previousRecreateBaselineRef.current;
    const baselineChanged = !sameRecreateBaseline(previous, recreateBaseline);
    const formMatchesPrevious =
      imageTag === previous.imageTag &&
      JSON.stringify(ports) === previous.ports &&
      JSON.stringify(mounts) === previous.mounts &&
      entrypoint === previous.entrypoint &&
      command === previous.command &&
      stopTimeout === previous.stopTimeout &&
      workingDir === previous.workingDir &&
      user === previous.user &&
      hostname === previous.hostname &&
      JSON.stringify(labels) === previous.labels;

    previousRecreateBaselineRef.current = recreateBaseline;

    if (!baselineChanged || !formMatchesPrevious) return;
    setImageTag(parsedTag);
    setPorts(initialPorts);
    setMounts(initialMounts);
    setEntrypoint(initialEntrypoint.join(" "));
    setCommand(initialCmd.join(" "));
    setStopTimeout(initialStopTimeout);
    setWorkingDir(initialWorkdir);
    setUser(initialUser);
    setHostname(initialHostname);
    setLabels(Object.entries(initialLabels).map(([key, value]) => ({ key, value })));
  }, [
    command,
    entrypoint,
    hostname,
    imageTag,
    initialCmd,
    initialEntrypoint,
    initialHostname,
    initialLabels,
    initialMounts,
    initialPorts,
    initialStopTimeout,
    initialUser,
    initialWorkdir,
    labels,
    mounts,
    parsedTag,
    ports,
    recreateBaseline,
    stopTimeout,
    user,
    workingDir,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadDockerRuntimeCapacity(nodeId).then((capacity) => {
      if (!cancelled) setRuntimeCapacity(capacity);
    });

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

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

  const executionValidationError = useMemo(() => {
    const parsedStopTimeout = parseOptionalNumber(stopTimeout);
    if (
      Number.isNaN(parsedStopTimeout) ||
      parsedStopTimeout === null ||
      !Number.isInteger(parsedStopTimeout) ||
      parsedStopTimeout < 0 ||
      parsedStopTimeout > 300
    ) {
      return "Stop grace must be a whole number from 0 to 300 seconds.";
    }
    return null;
  }, [stopTimeout]);

  const buildRuntimePayload = useCallback(() => {
    return buildRuntimePayloadFromForm(
      {
        restartPolicy,
        maxRetries,
        memoryMB,
        memSwapMB,
        cpuCount,
        cpuShares,
        pidsLimit,
      },
      baselineRef.current
    );
  }, [restartPolicy, maxRetries, memoryMB, memSwapMB, cpuCount, cpuShares, pidsLimit]);

  // ── Live update handler ──
  const handleLiveUpdate = useCallback(async () => {
    setLiveLoading(true);
    onMutationStart?.("updating");
    try {
      if (runtimeValidationError) {
        onMutationEnd?.();
        toast.error(runtimeValidationError);
        return;
      }

      const payload = buildRuntimePayload();
      if (!payload) {
        onMutationEnd?.();
        toast.info("No changes to apply");
        return;
      }

      await api.liveUpdateContainer(nodeId, containerId, payload);
      toast.success(
        recreatesRunningContainer
          ? "Settings applied (no restart needed)"
          : "Container runtime configuration saved"
      );
      if (recreatesRunningContainer) {
        invalidate("containers", "tasks");
        await Promise.resolve(onRefresh?.());
        onMutationEnd?.();
      } else {
        invalidate("containers", "tasks");
        await Promise.resolve(onRefresh?.());
        onMutationEnd?.();
      }

      // Update baseline so hasRuntimeChanges becomes false immediately
      baselineRef.current = {
        restartPolicy,
        maxRetries,
        memoryMB,
        memSwapMB,
        cpuCount,
        cpuShares,
        pidsLimit,
      };
    } catch (err) {
      onMutationEnd?.();
      toast.error(err instanceof Error ? err.message : "Failed to apply settings");
    } finally {
      setLiveLoading(false);
    }
  }, [
    buildRuntimePayload,
    containerId,
    invalidate,
    maxRetries,
    memoryMB,
    memSwapMB,
    nodeId,
    onRefresh,
    pidsLimit,
    recreatesRunningContainer,
    restartPolicy,
    cpuCount,
    cpuShares,
    onMutationEnd,
    onMutationStart,
    runtimeValidationError,
  ]);

  // ── Track recreate changes per section ──
  const portsChanged = JSON.stringify(ports) !== recreateBaseline.ports;
  const mountsChanged = JSON.stringify(mounts) !== recreateBaseline.mounts;
  const execChanged =
    entrypoint !== recreateBaseline.entrypoint ||
    command !== recreateBaseline.command ||
    stopTimeout !== recreateBaseline.stopTimeout ||
    workingDir !== recreateBaseline.workingDir ||
    user !== recreateBaseline.user ||
    hostname !== recreateBaseline.hostname;
  const labelsChanged = JSON.stringify(labels) !== recreateBaseline.labels;
  const hasRecreateChanges =
    portsChanged || mountsChanged || execChanged || labelsChanged || imageTagChanged;

  // ── Track runtime changes against baseline ──
  const b = baselineRef.current;
  const hasRuntimeChanges =
    restartPolicy !== b.restartPolicy ||
    maxRetries !== b.maxRetries ||
    memoryMB !== b.memoryMB ||
    memSwapMB !== b.memSwapMB ||
    cpuCount !== b.cpuCount ||
    cpuShares !== b.cpuShares ||
    pidsLimit !== b.pidsLimit;

  // ── Recreate handler ──
  const handleRecreate = useCallback(async () => {
    const ok = await confirm({
      title: recreatesRunningContainer ? "Save & Recreate" : "Save",
      description: recreatesRunningContainer
        ? "This will stop and recreate the container with the new configuration. The container will experience downtime. Continue?"
        : "This will save the new container configuration. The container will remain stopped. Continue?",
      confirmLabel: recreatesRunningContainer ? "Recreate" : "Save",
    });
    if (!ok) return;

    setRecreateLoading(true);
    onMutationStart?.("recreating");
    try {
      if (hasRuntimeChanges && runtimeValidationError) {
        onMutationEnd?.();
        toast.error(runtimeValidationError);
        setRecreateLoading(false);
        return;
      }
      if (executionValidationError) {
        onMutationEnd?.();
        toast.error(executionValidationError);
        setRecreateLoading(false);
        return;
      }

      const payload = buildRecreatePayloadFromForm({
        parsedImageName,
        imageTag,
        imageTagChanged,
        portsChanged,
        ports,
        mountsChanged,
        mounts,
        entrypoint,
        command,
        stopTimeout,
        workingDir,
        user,
        hostname,
        labelsChanged,
        labels,
        hasRuntimeChanges,
        runtimePayload: buildRuntimePayload(),
        recreateBaseline,
      });

      await api.recreateWithConfig(nodeId, containerId, payload);
      toast.success(
        recreatesRunningContainer ? "Recreating container..." : "Container configuration saved"
      );
      invalidate("containers", "tasks");
      // Trigger an immediate no-cache refresh and keep the UI locked until
      // the detail view has observed the updated container state.
      await Promise.resolve(onRecreating?.());
      setRecreateLoading(false);
    } catch (err) {
      onMutationEnd?.();
      toast.error(err instanceof Error ? err.message : "Failed to recreate container");
      setRecreateLoading(false);
    }
  }, [
    command,
    containerId,
    entrypoint,
    executionValidationError,
    hostname,
    imageTag,
    imageTagChanged,
    invalidate,
    labels,
    labelsChanged,
    mounts,
    mountsChanged,
    nodeId,
    onRecreating,
    parsedImageName,
    ports,
    portsChanged,
    buildRuntimePayload,
    hasRuntimeChanges,
    recreateBaseline,
    recreatesRunningContainer,
    runtimeValidationError,
    stopTimeout,
    user,
    workingDir,
    onMutationEnd,
    onMutationStart,
  ]);

  // ── Shared input styles ──
  const inputCell =
    "h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div
      className={`space-y-6 pb-6 ${recreateLoading || !!transition ? "pointer-events-none opacity-60" : ""}`}
    >
      {/* ─── Runtime Settings + Execution (side by side) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RuntimeSection
          canEdit={canEdit}
          appliesLive={recreatesRunningContainer}
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
          hasRuntimeChanges={hasRuntimeChanges}
          liveLoading={liveLoading}
          onApply={handleLiveUpdate}
        />

        <div
          className="border bg-card overflow-hidden"
          style={execChanged || imageTagChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Execution</h3>
              <p className="text-xs text-muted-foreground">Requires container recreation</p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                className="hover:opacity-90 disabled:opacity-50"
                onClick={handleRecreate}
                disabled={
                  recreateLoading ||
                  !hasRecreateChanges ||
                  !!executionValidationError ||
                  (hasRuntimeChanges && !!runtimeValidationError)
                }
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {recreatesRunningContainer ? "Save & Recreate" : "Save"}
              </Button>
            )}
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Image</label>
                <Input
                  className="h-8 text-xs font-mono bg-muted/50"
                  value={parsedImageName}
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
                  disabled={!canEdit || imageTagLocked}
                  style={imageTagChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Entrypoint</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                  placeholder="/docker-entrypoint.sh"
                  disabled={!canEdit}
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
                  disabled={!canEdit}
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
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Hostname</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="container-hostname"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Command</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="nginx -g daemon off;"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Stop Grace (s)</label>
                <Input
                  className="h-8 text-xs font-mono"
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  value={stopTimeout}
                  onChange={(e) => setStopTimeout(e.target.value)}
                  placeholder="20"
                  disabled={!canEdit}
                  style={
                    stopTimeout !== recreateBaseline.stopTimeout
                      ? { borderColor: "rgb(234 179 8)" }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Port Mappings ────────────────────────────────────────── */}
      <PortMappingsSection
        canEdit={canEdit}
        ports={ports}
        setPorts={setPorts}
        portsChanged={portsChanged}
        inputCell={inputCell}
      />

      {/* ─── Volume Mounts ────────────────────────────────────────── */}
      <VolumeMountsSection
        canEdit={canEdit && canEditMounts}
        mounts={mounts}
        setMounts={setMounts}
        mountsChanged={mountsChanged}
        inputCell={inputCell}
      />

      {/* ─── Labels ───────────────────────────────────────────────── */}
      <LabelsSection
        canEdit={canEdit}
        labels={labels}
        setLabels={setLabels}
        labelsChanged={labelsChanged}
        inputCell={inputCell}
      />

      <DockerHealthCheckSection
        nodeId={nodeId}
        target="container"
        containerName={containerName}
        disabled={!canEdit}
        onSaved={(healthCheck) => {
          onHealthCheckSaved?.(healthCheck);
          invalidate("containers");
        }}
      />

      {/* ─── Networks ─────────────────────────────────────────────── */}
      <NetworksSection
        nodeId={nodeId}
        containerId={containerId}
        networks={data.NetworkSettings?.Networks as Record<string, Record<string, unknown>>}
        canManageNetworks={canManageNetworks}
        canListNetworks={canListNetworks}
        onRefresh={onRefresh}
      />

      {/* ─── Webhook / Image Cleanup ─────────────────────────────── */}
      {(() => {
        const canManageWebhooks =
          hasScope("docker:containers:webhooks") ||
          hasScope(`docker:containers:webhooks:${nodeId}`);
        if (!canManageWebhooks && !canEdit) return null;
        return (
          <WebhookSection
            nodeId={nodeId}
            containerName={containerName}
            allowWebhook={canManageWebhooks}
            allowCleanup={canEdit}
          />
        );
      })()}
    </div>
  );
}
