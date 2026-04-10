import { Check, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerWebhook } from "@/types";
import type { InspectData } from "./helpers";
import { LabelsSection } from "./LabelsSection";
import { PortMappingsSection, type PortMapping } from "./PortMappingsSection";
import { RuntimeSection } from "./RuntimeSection";
import { VolumeMountsSection, type MountEntry } from "./VolumeMountsSection";

// ── Component ────────────────────────────────────────────────────

export function SettingsTab({
  nodeId,
  containerId,
  data,
  onRecreating,
  transition,
}: {
  nodeId: string;
  containerId: string;
  data: InspectData;
  onRecreating?: () => void;
  transition?: string;
}) {
  const { hasScope } = useAuthStore();
  const invalidate = useDockerStore((s) => s.invalidate);
  const canEdit = hasScope("docker:containers:edit");

  // ── Live settings state (no recreation) ──
  const hostConfig = data.HostConfig ?? {};
  const currentRestartPolicy = hostConfig.RestartPolicy?.Name ?? "no";
  const currentMaxRetries = hostConfig.RestartPolicy?.MaximumRetryCount ?? 0;
  const currentMemory = hostConfig.Memory ?? 0;
  const currentMemSwap = hostConfig.MemorySwap ?? 0;
  const currentNanoCPUs = hostConfig.NanoCPUs ?? 0;
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
  const initialPorts: PortMapping[] = [];
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    if (bindings) {
      const [port, proto] = containerPort.split("/");
      for (const b of bindings) {
        initialPorts.push({
          hostPort: b.HostPort ?? "",
          containerPort: port,
          protocol: (proto as "tcp" | "udp") ?? "tcp",
        });
      }
    }
  }

  const initialMounts: MountEntry[] = (
    (data.Mounts ?? []) as Array<{
      Type: string;
      Source: string;
      Destination: string;
      Name?: string;
      RW: boolean;
    }>
  ).map((m) => ({
    hostPath: m.Type === "bind" ? m.Source : "",
    containerPath: m.Destination,
    name: m.Type === "volume" ? (m.Name ?? m.Source) : "",
    readOnly: !m.RW,
  }));

  const config = data.Config ?? {};
  const containerName = useMemo(
    () => ((data.Name ?? "") as string).replace(/^\//, ""),
    [data.Name],
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

  // Snapshot initial recreate values (frozen per container, not re-derived on every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    [containerId]
  );

  // ── Live update handler ──
  const handleLiveUpdate = useCallback(async () => {
    setLiveLoading(true);
    try {
      const payload: Record<string, unknown> = {};
      if (restartPolicy !== currentRestartPolicy) payload.restartPolicy = restartPolicy;
      if (restartPolicy === "on-failure" && Number(maxRetries) !== currentMaxRetries) {
        payload.maxRetries = Number(maxRetries) || 0;
      }
      const memBytes = memoryMB ? Number(memoryMB) * 1048576 : 0;
      const swapOnly = memSwapMB === "-1" ? -1 : memSwapMB ? Number(memSwapMB) * 1048576 : 0;
      // Docker requires memorySwap >= memory, so always send both together
      // Empty swap = double memory (Docker's default), -1 = unlimited, 0 = no swap
      const combinedSwap =
        swapOnly === -1 ? -1 : swapOnly > 0 ? memBytes + swapOnly : memBytes > 0 ? memBytes * 2 : 0;
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
        toast.info("No changes to apply");
        return;
      }
      if (!payload.restartPolicy) payload.restartPolicy = restartPolicy;

      await api.liveUpdateContainer(nodeId, containerId, payload);
      toast.success("Settings applied (no restart needed)");
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
    nodeId,
    containerId,
    restartPolicy,
    maxRetries,
    memoryMB,
    memSwapMB,
    cpuCount,
    cpuShares,
    pidsLimit,
    currentRestartPolicy,
    currentMaxRetries,
    currentMemory,
    currentMemSwap,
    currentNanoCPUs,
    currentCpuShares,
    currentPidsLimit,
  ]);

  // ── Recreate handler ──
  const handleRecreate = useCallback(async () => {
    const ok = await confirm({
      title: "Recreate Container",
      description:
        "This will stop and recreate the container with the new configuration. The container will experience downtime. Continue?",
      confirmLabel: "Recreate",
    });
    if (!ok) return;

    setRecreateLoading(true);
    try {
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

      await api.recreateWithConfig(nodeId, containerId, payload);
      toast.success("Recreating container...");
      // Trigger an immediate parent refresh; the realtime channel will deliver
      // the recreate event (with new id) to every open tab, including this one,
      // and the parent navigates accordingly.
      onRecreating?.();
      invalidate("containers", "tasks");
      setRecreateLoading(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to recreate container");
      setRecreateLoading(false);
    }
  }, [
    nodeId,
    containerId,
    ports,
    mounts,
    entrypoint,
    command,
    workingDir,
    user,
    hostname,
    labels,
    imageTag,
    imageTagChanged,
    parsedImageName,
    onRecreating,
  ]);

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
  const hasRecreateChanges = portsChanged || mountsChanged || execChanged || labelsChanged || imageTagChanged;

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
                disabled={recreateLoading || !hasRecreateChanges}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Recreate
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

      {/* ─── Webhook ─────────────────────────────────────────────── */}
      {hasScope("docker:containers:webhooks") && (
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
    [nodeId, containerName],
  );

  const handleCleanupToggle = useCallback(
    (v: boolean) => {
      setCleanupEnabled(v);
      autoSave({ cleanupEnabled: v });
    },
    [autoSave],
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
      <div className={`flex items-center justify-between px-4 py-3 ${webhook ? "border-b border-border" : ""}`}>
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
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
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
                {copiedCurl ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
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
              <p className={`text-sm font-medium ${!cleanupEnabled ? "text-muted-foreground" : ""}`}>
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
