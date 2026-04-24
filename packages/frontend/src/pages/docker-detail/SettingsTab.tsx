import { Check, Copy, Plus, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerNetwork, DockerWebhook, NodeDetail } from "@/types";
import type { InspectData } from "./helpers";
import { LabelsSection } from "./LabelsSection";
import { type PortMapping, PortMappingsSection } from "./PortMappingsSection";
import { RuntimeSection } from "./RuntimeSection";
import { type MountEntry, VolumeMountsSection } from "./VolumeMountsSection";

function normalizeDockerNetwork(network: DockerNetwork | Record<string, unknown>): DockerNetwork {
  const raw = network as Record<string, unknown>;
  return {
    id: String(raw.id ?? raw.Id ?? ""),
    name: String(raw.name ?? raw.Name ?? ""),
    driver: String(raw.driver ?? raw.Driver ?? ""),
    scope: String(raw.scope ?? raw.Scope ?? ""),
    ipam: (raw.ipam ?? raw.IPAM ?? undefined) as DockerNetwork["ipam"],
    containers: (raw.containers ?? raw.Containers ?? undefined) as DockerNetwork["containers"],
  };
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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
  onRecreating,
  onRefresh,
  transition,
}: {
  nodeId: string;
  containerId: string;
  data: InspectData;
  onRecreating?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  transition?: string;
}) {
  const { hasScope } = useAuthStore();
  const invalidate = useDockerStore((s) => s.invalidate);
  const canEdit =
    hasScope("docker:containers:edit") || hasScope(`docker:containers:edit:${nodeId}`);
  const canManageNetworks = hasScope("docker:networks:edit");
  const canListNetworks = hasScope("docker:networks:list");
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

  const [restartPolicy, setRestartPolicy] = useState(currentRestartPolicy);
  const [maxRetries, setMaxRetries] = useState(String(currentMaxRetries));
  const [memoryMB, setMemoryMB] = useState(initMem);
  const [memSwapMB, setMemSwapMB] = useState(initSwap);
  const [cpuCount, setCpuCount] = useState(initCpu);
  const [cpuShares, setCpuShares] = useState(initShares);
  const [pidsLimit, setPidsLimit] = useState(initPids);
  const [liveLoading, setLiveLoading] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null);

  // Baseline snapshot — updated after successful live apply
  const baselineRef = useRef({
    restartPolicy: currentRestartPolicy,
    maxRetries: String(currentMaxRetries),
    memoryMB: initMem,
    memSwapMB: initSwap,
    cpuCount: initCpu,
    cpuShares: initShares,
    pidsLimit: initPids,
  });

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
    const lastColon = currentImage.lastIndexOf(":");
    const lastSlash = currentImage.lastIndexOf("/");
    if (lastColon === -1 || lastSlash > lastColon) {
      return { imageName: currentImage, tag: "latest" };
    }
    return { imageName: currentImage.slice(0, lastColon), tag: currentImage.slice(lastColon + 1) };
  }, [currentImage]);

  const [imageTag, setImageTag] = useState(parsedTag);
  useEffect(() => setImageTag(parsedTag), [parsedTag]);
  const imageTagChanged = imageTag !== parsedTag;

  const initialEntrypoint = (config.Entrypoint ?? []) as string[];
  const initialCmd = (config.Cmd ?? []) as string[];
  const initialWorkdir = (config.WorkingDir ?? "") as string;
  const initialUser = (config.User ?? "") as string;
  const initialHostname = (config.Hostname ?? "") as string;
  const initialLabels = (config.Labels ?? {}) as Record<string, string>;

  const [ports, setPorts] = useState<PortMapping[]>(initialPorts);
  const [mounts, setMounts] = useState<MountEntry[]>(initialMounts);
  const [entrypoint, setEntrypoint] = useState(initialEntrypoint.join(" "));
  const [command, setCommand] = useState(initialCmd.join(" "));
  const [workingDir, setWorkingDir] = useState(initialWorkdir);
  const [user, setUser] = useState(initialUser);
  const [hostname, setHostname] = useState(initialHostname);
  const [labels, setLabels] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initialLabels).map(([key, value]) => ({ key, value }))
  );
  const [recreateLoading, setRecreateLoading] = useState(false);
  const [allNetworks, setAllNetworks] = useState<DockerNetwork[]>([]);
  const [networksLoading, setNetworksLoading] = useState(false);
  const [networkActionLoading, setNetworkActionLoading] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [addingNetwork, setAddingNetwork] = useState(false);

  const recreateBaseline = useMemo(
    () => ({
      ports: JSON.stringify(initialPorts),
      mounts: JSON.stringify(initialMounts),
      entrypoint: initialEntrypoint.join(" "),
      command: initialCmd.join(" "),
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
      initialUser,
      initialWorkdir,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .getNode(nodeId)
      .then((node) => {
        if (!cancelled) setNodeDetail(node);
      })
      .catch(() => {
        if (!cancelled) setNodeDetail(null);
      });

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const runtimeCapacity = useMemo(() => {
    const caps = (nodeDetail?.capabilities ?? {}) as Record<string, unknown>;
    const cpuCoresRaw = Number(caps.cpuCores ?? 0);
    const maxCpuCount = Number.isFinite(cpuCoresRaw) && cpuCoresRaw > 0 ? cpuCoresRaw : null;
    const health = nodeDetail?.liveHealthReport ?? nodeDetail?.lastHealthReport ?? null;
    const memoryBytesRaw = Number(health?.systemMemoryTotalBytes ?? 0);
    const swapBytesRaw = Number(health?.swapTotalBytes ?? 0);

    return {
      maxCpuCount,
      maxMemoryBytes: Number.isFinite(memoryBytesRaw) && memoryBytesRaw > 0 ? memoryBytesRaw : null,
      maxSwapBytes: Number.isFinite(swapBytesRaw) && swapBytesRaw > 0 ? swapBytesRaw : null,
    };
  }, [nodeDetail]);

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
      runtimeCapacity.maxSwapBytes && runtimeCapacity.maxSwapBytes > 0
        ? runtimeCapacity.maxSwapBytes / 1048576
        : null;
    if (
      maxSwapMB &&
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

  const buildRuntimePayload = useCallback(() => {
    const payload: Record<string, unknown> = {};
    if (restartPolicy !== currentRestartPolicy) payload.restartPolicy = restartPolicy;
    if (restartPolicy === "on-failure" && Number(maxRetries) !== currentMaxRetries) {
      payload.maxRetries = Number(maxRetries) || 0;
    }
    const memBytes = memoryMB ? Number(memoryMB) * 1048576 : 0;
    const swapOnly = memSwapMB === "-1" ? -1 : memSwapMB ? Number(memSwapMB) * 1048576 : 0;
    const combinedSwap =
      swapOnly === -1 ? -1 : memBytes > 0 ? memBytes + Math.max(0, swapOnly) : 0;
    if (memBytes !== currentMemory || combinedSwap !== currentMemSwap) {
      payload.memoryLimit = memBytes;
      payload.memorySwap = combinedSwap;
    }
    const nanos = cpuCount ? Math.round(Number(cpuCount) * 1e9) : 0;
    if (nanos !== currentNanoCPUs) payload.nanoCPUs = nanos;
    const shares = cpuShares ? Number(cpuShares) : 0;
    if (shares !== currentCpuShares) payload.cpuShares = shares;
    const pids = pidsLimit ? Number(pidsLimit) : 0;
    if (pids !== currentPidsLimit) payload.pidsLimit = pids;

    if (Object.keys(payload).length === 0) {
      return null;
    }
    if (!("restartPolicy" in payload)) {
      payload.restartPolicy = restartPolicy;
    }
    return payload;
  }, [
    restartPolicy,
    currentRestartPolicy,
    maxRetries,
    currentMaxRetries,
    memoryMB,
    memSwapMB,
    currentMemory,
    currentMemSwap,
    cpuCount,
    currentNanoCPUs,
    cpuShares,
    currentCpuShares,
    pidsLimit,
    currentPidsLimit,
  ]);

  // ── Live update handler ──
  const handleLiveUpdate = useCallback(async () => {
    setLiveLoading(true);
    try {
      if (runtimeValidationError) {
        toast.error(runtimeValidationError);
        return;
      }

      const payload = buildRuntimePayload();
      if (!payload) {
        toast.info("No changes to apply");
        return;
      }

      await api.liveUpdateContainer(nodeId, containerId, payload);
      toast.success(
        recreatesRunningContainer
          ? "Settings applied (no restart needed)"
          : "Container runtime configuration saved"
      );
      if (!recreatesRunningContainer) {
        invalidate("containers", "tasks");
        await Promise.resolve(onRecreating?.());
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
    onRecreating,
    pidsLimit,
    recreatesRunningContainer,
    restartPolicy,
    cpuCount,
    cpuShares,
    runtimeValidationError,
  ]);

  // ── Track recreate changes per section ──
  const portsChanged = JSON.stringify(ports) !== recreateBaseline.ports;
  const mountsChanged = JSON.stringify(mounts) !== recreateBaseline.mounts;
  const execChanged =
    entrypoint !== recreateBaseline.entrypoint ||
    command !== recreateBaseline.command ||
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
    try {
      if (hasRuntimeChanges && runtimeValidationError) {
        toast.error(runtimeValidationError);
        setRecreateLoading(false);
        return;
      }

      // If the image tag changed, pull the new image first to validate it exists
      if (imageTagChanged) {
        const newRef = `${parsedImageName}:${imageTag}`;
        try {
          await api.pullImageSync(nodeId, newRef);
        } catch {
          toast.error(`Failed to pull image ${newRef} — check the tag is valid`);
          setRecreateLoading(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {};

      // Include new image if tag changed
      if (imageTagChanged) {
        payload.image = `${parsedImageName}:${imageTag}`;
      }

      // Only send fields that changed
      if (portsChanged) {
        payload.ports = ports
          .filter((p) => p.containerPort)
          .map((p) => ({
            hostPort: Number(p.hostPort) || 0,
            containerPort: Number(p.containerPort),
            protocol: p.protocol,
          }));
      }
      if (mountsChanged) {
        payload.mounts = mounts
          .filter((m) => m.containerPath)
          .map((m) => ({
            hostPath: m.hostPath,
            containerPath: m.containerPath,
            name: m.name,
            readOnly: m.readOnly,
          }));
      }
      if (entrypoint !== recreateBaseline.entrypoint) {
        const ep = entrypoint.trim();
        payload.entrypoint = ep ? parseShellWords(ep) : [];
      }
      if (command !== recreateBaseline.command) {
        const cmd = command.trim();
        payload.command = cmd ? parseShellWords(cmd) : [];
      }
      if (workingDir !== recreateBaseline.workingDir) payload.workingDir = workingDir;
      if (user !== recreateBaseline.user) payload.user = user;
      if (hostname !== recreateBaseline.hostname) payload.hostname = hostname;
      if (labelsChanged) {
        const labelMap: Record<string, string> = {};
        for (const l of labels) {
          if (l.key.trim()) labelMap[l.key.trim()] = l.value;
        }
        payload.labels = labelMap;
      }
      if (hasRuntimeChanges) {
        Object.assign(payload, buildRuntimePayload() ?? {});
      }

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
      toast.error(err instanceof Error ? err.message : "Failed to recreate container");
      setRecreateLoading(false);
    }
  }, [
    command,
    containerId,
    entrypoint,
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
    user,
    workingDir,
  ]);

  // ── Shared input styles ──
  const inputCell =
    "h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  const attachedNetworks = useMemo(
    () =>
      Object.entries(
        (data.NetworkSettings?.Networks ?? {}) as Record<string, Record<string, unknown>>
      ).map(([name, config]) => ({
        name,
        networkId: String(config.NetworkID ?? ""),
        ipAddress: String(config.IPAddress ?? ""),
        gateway: String(config.Gateway ?? ""),
        aliases: Array.isArray(config.Aliases)
          ? (config.Aliases as unknown[]).map((alias) => String(alias))
          : [],
      })),
    [data.NetworkSettings?.Networks]
  );

  const attachedNames = useMemo(
    () => new Set(attachedNetworks.map((network) => network.name)),
    [attachedNetworks]
  );

  const availableNetworks = useMemo(
    () => allNetworks.filter((network) => !attachedNames.has(network.name)),
    [allNetworks, attachedNames]
  );

  const isBuiltInDockerNetwork = useCallback(
    (name: string) => ["bridge", "host", "none"].includes(name),
    []
  );

  const loadNetworks = useCallback(async () => {
    if (!canListNetworks) return;
    setNetworksLoading(true);
    try {
      const networks = await api.listDockerNetworks(nodeId);
      setAllNetworks((networks ?? []).map((network) => normalizeDockerNetwork(network)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load networks");
    } finally {
      setNetworksLoading(false);
    }
  }, [canListNetworks, nodeId]);

  useEffect(() => {
    if (!canListNetworks) return;
    void loadNetworks();
  }, [canListNetworks, loadNetworks]);

  useEffect(() => {
    if (availableNetworks.length === 0) {
      setSelectedNetworkId("");
      setAddingNetwork(false);
      return;
    }
    if (!availableNetworks.some((network) => network.id === selectedNetworkId)) {
      setSelectedNetworkId(availableNetworks[0]?.id ?? "");
    }
  }, [availableNetworks, selectedNetworkId]);

  useRealtime("docker.network.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (!ev || ev.nodeId !== nodeId) return;
    void loadNetworks();
  });

  const refreshAfterNetworkChange = useCallback(async () => {
    await invalidate("containers", "networks");
    await Promise.all([loadNetworks(), Promise.resolve(onRefresh?.())]);
  }, [invalidate, loadNetworks, onRefresh]);

  const handleConnectNetwork = useCallback(async () => {
    if (!selectedNetworkId) return;
    setNetworkActionLoading(`connect:${selectedNetworkId}`);
    try {
      await api.connectContainerToNetwork(nodeId, selectedNetworkId, containerId);
      toast.success("Network connected");
      setAddingNetwork(false);
      await refreshAfterNetworkChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect network");
    } finally {
      setNetworkActionLoading(null);
    }
  }, [containerId, nodeId, refreshAfterNetworkChange, selectedNetworkId]);

  const handleDisconnectNetwork = useCallback(
    async (networkId: string, networkName: string) => {
      setNetworkActionLoading(`disconnect:${networkId}`);
      try {
        await api.disconnectContainerFromNetwork(nodeId, networkId, containerId);
        toast.success(`Disconnected from ${networkName}`);
        await refreshAfterNetworkChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to disconnect network");
      } finally {
        setNetworkActionLoading(null);
      }
    },
    [containerId, nodeId, refreshAfterNetworkChange]
  );

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
                  recreateLoading || !hasRecreateChanges || (hasRuntimeChanges && !!runtimeValidationError)
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
                  placeholder="latest"
                  disabled={!canEdit}
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
        canEdit={canEdit}
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

      {/* ─── Networks ─────────────────────────────────────────────── */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Networks</h3>
            <p className="text-xs text-muted-foreground">
              Connect this container to additional Docker networks
            </p>
          </div>
          {canManageNetworks && canListNetworks && (
            <Button
              size="sm"
              onClick={() => setAddingNetwork(true)}
              disabled={addingNetwork || networksLoading || availableNetworks.length === 0}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
        {attachedNetworks.length > 0 || addingNetwork ? (
          <>
            <div
              className={`grid ${
                canManageNetworks
                  ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                  : "grid-cols-[minmax(0,1fr)_120px_120px]"
              } border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}
            >
              <div className="px-3 py-2">Network</div>
              <div className="px-3 py-2 border-l border-border">IP</div>
              <div className="px-3 py-2 border-l border-border">Gateway</div>
              {canManageNetworks && <div />}
            </div>
            <div>
              {attachedNetworks.map((network) => (
                <div
                  key={`${network.name}:${network.networkId}`}
                  className={`grid ${
                    canManageNetworks
                      ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                      : "grid-cols-[minmax(0,1fr)_120px_120px]"
                  } border-b border-border last:border-b-0`}
                >
                  <div className="flex min-w-0 items-center px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{network.name}</span>
                      {network.aliases.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {network.aliases.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center border-l border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                    <span className="truncate">{network.ipAddress || "-"}</span>
                  </div>
                  <div className="flex items-center border-l border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                    <span className="truncate">{network.gateway || "-"}</span>
                  </div>
                  {canManageNetworks && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                      disabled={
                        !!networkActionLoading ||
                        !network.networkId ||
                        isBuiltInDockerNetwork(network.name)
                      }
                      onClick={() => handleDisconnectNetwork(network.networkId, network.name)}
                    >
                      <Unplug className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {addingNetwork && (
                <div
                  className={`grid ${
                    canManageNetworks
                      ? "grid-cols-[minmax(0,1fr)_120px_120px_36px]"
                      : "grid-cols-[minmax(0,1fr)_120px_120px]"
                  } border-b border-border last:border-b-0`}
                >
                  <div className="min-w-0">
                    <Select
                      value={selectedNetworkId}
                      onValueChange={setSelectedNetworkId}
                      disabled={
                        !canManageNetworks || networksLoading || availableNetworks.length === 0
                      }
                    >
                      <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                        <SelectValue
                          placeholder={networksLoading ? "Loading networks..." : "Select a network"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {availableNetworks.map((network) => (
                          <SelectItem key={network.id} value={network.id}>
                            {network.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center border-l border-border px-3 py-2 text-xs text-muted-foreground">
                    -
                  </div>
                  <div className="flex items-center border-l border-border px-3 py-2 text-xs text-muted-foreground">
                    -
                  </div>
                  {canManageNetworks && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                      disabled={!selectedNetworkId || networksLoading || !!networkActionLoading}
                      onClick={handleConnectNetwork}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No networks</div>
        )}
      </div>

      {/* ─── Webhook ─────────────────────────────────────────────── */}
      {(hasScope("docker:containers:webhooks") ||
        hasScope(`docker:containers:webhooks:${nodeId}`)) && (
        <WebhookSection nodeId={nodeId} containerName={containerName} />
      )}
    </div>
  );
}

// ── Webhook Section ──────────────────────────────────────────────

function WebhookSection({ nodeId, containerName }: { nodeId: string; containerName: string }) {
  const [webhook, setWebhook] = useState<DockerWebhook | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  // Cleanup config local state
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [retentionCount, setRetentionCount] = useState("2");

  const fetchWebhook = useCallback(async () => {
    try {
      const data = await api.getContainerWebhook(nodeId, containerName);
      setWebhook(data);
      if (data) {
        setCleanupEnabled(data.cleanupEnabled);
        setRetentionCount(String(data.retentionCount));
      }
    } catch {
      // Ignore — not configured
    } finally {
      setLoading(false);
    }
  }, [nodeId, containerName]);

  useEffect(() => {
    fetchWebhook();
  }, [fetchWebhook]);

  useRealtime("docker.webhook.changed", (payload: unknown) => {
    const p = payload as Record<string, unknown>;
    if (p.nodeId === nodeId && p.containerName === containerName) {
      fetchWebhook();
    }
  });

  const webhookUrl = webhook
    ? `${window.location.origin}/api/webhooks/docker/${webhook.token}`
    : "";
  const curlExample = webhook
    ? `curl -X POST ${webhookUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"tag":"v1.0.0"}'`
    : "";

  const handleEnable = async () => {
    try {
      const data = await api.upsertContainerWebhook(nodeId, containerName, {});
      setWebhook(data);
      setCleanupEnabled(data.cleanupEnabled);
      setRetentionCount(String(data.retentionCount));
      toast.success("Webhook enabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enable webhook");
    }
  };

  const autoSave = useCallback(
    async (patch: { cleanupEnabled?: boolean; retentionCount?: number }) => {
      try {
        const data = await api.upsertContainerWebhook(nodeId, containerName, patch);
        setWebhook(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [nodeId, containerName]
  );

  const handleCleanupToggle = useCallback(
    (v: boolean) => {
      setCleanupEnabled(v);
      autoSave({ cleanupEnabled: v });
    },
    [autoSave]
  );

  const handleRetentionBlur = useCallback(() => {
    const v = Math.max(1, Math.min(50, Number(retentionCount) || 2));
    setRetentionCount(String(v));
    if (webhook && v !== webhook.retentionCount) {
      autoSave({ retentionCount: v });
    }
  }, [retentionCount, webhook, autoSave]);

  const handleRegenerate = async () => {
    const ok = await confirm({
      title: "Regenerate Webhook URL",
      description:
        "This will invalidate the current webhook URL. Any CI pipelines using the old URL will stop working. Continue?",
      confirmLabel: "Regenerate",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      const data = await api.regenerateWebhookToken(nodeId, containerName);
      setWebhook(data);
      toast.success("Webhook URL regenerated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate");
    }
  };

  const handleDisable = async () => {
    const ok = await confirm({
      title: "Disable Webhook",
      description:
        "This will delete the webhook configuration and URL. CI pipelines using this URL will stop working. Continue?",
      confirmLabel: "Disable",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.deleteContainerWebhook(nodeId, containerName);
      setWebhook(null);
      toast.success("Webhook disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disable");
    }
  };

  const copyToClipboard = (text: string, type: "url" | "curl") => {
    navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    }
  };

  if (loading) return null;

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      await handleEnable();
    } else {
      await handleDisable();
    }
  };

  return (
    <div className="border border-border bg-card overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-3 ${webhook ? "border-b border-border" : ""}`}
      >
        <div>
          <h3 className="text-sm font-semibold">Webhook</h3>
          <p className="text-xs text-muted-foreground">
            Trigger container updates from CI pipelines
          </p>
        </div>
        <Switch checked={!!webhook} onChange={handleToggle} />
      </div>

      {webhook && (
        <div className="divide-y divide-border">
          {/* Webhook URL */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Webhook URL</p>
              <div className="flex gap-1.5 mt-1.5">
                <Input
                  className="h-8 text-xs font-mono flex-1"
                  value={webhookUrl}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => copyToClipboard(webhookUrl, "url")}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleRegenerate}
                  title="Regenerate URL"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* curl example */}
          <div className="px-4 py-3">
            <p className="text-sm font-medium">Example</p>
            <div className="relative mt-1.5">
              <pre className="bg-muted/50 border border-border rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                {curlExample}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1.5 right-1.5 h-6 w-6"
                onClick={() => copyToClipboard(curlExample, "curl")}
              >
                {copiedCurl ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          {/* Auto-cleanup toggle */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Auto-cleanup old images</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Remove old image versions after updates
              </p>
            </div>
            <Switch checked={cleanupEnabled} onChange={handleCleanupToggle} />
          </div>

          {/* Retention count */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p
                className={`text-sm font-medium ${!cleanupEnabled ? "text-muted-foreground" : ""}`}
              >
                Keep last N versions
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Number of old image versions to retain
              </p>
            </div>
            <Input
              type="number"
              className="h-8 text-xs w-20 shrink-0"
              value={retentionCount}
              onChange={(e) => setRetentionCount(e.target.value)}
              disabled={!cleanupEnabled}
              min={1}
              max={50}
              onBlur={handleRetentionBlur}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function parseShellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === " " && !inQuotes) {
      if (current) {
        words.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);
  return words;
}
