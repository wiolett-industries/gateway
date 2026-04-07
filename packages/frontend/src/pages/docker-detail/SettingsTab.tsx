import { Minus, Plus, RotateCcw, Save } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { InspectData } from "./helpers";

// ── Types ────────────────────────────────────────────────────────

interface PortMapping {
  hostPort: string;
  containerPort: string;
  protocol: "tcp" | "udp";
}

interface MountEntry {
  hostPath: string;
  containerPath: string;
  name: string;
  readOnly: boolean;
}

// ── Component ────────────────────────────────────────────────────

export function SettingsTab({
  nodeId,
  containerId,
  data,
  onAction,
  onRecreating,
  transition,
}: {
  nodeId: string;
  containerId: string;
  data: InspectData;
  onAction: () => void;
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
  const currentSwap = currentMemSwap === -1 ? -1 : currentMemSwap > 0 ? Math.max(0, currentMemSwap - currentMemory) : 0;
  const initSwap = currentSwap === -1 ? "-1" : currentSwap > 0 ? String(Math.round(currentSwap / 1048576)) : "";
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

  const initialMounts: MountEntry[] = ((data.Mounts ?? []) as Array<{
    Type: string;
    Source: string;
    Destination: string;
    Name?: string;
    RW: boolean;
  }>).map((m) => ({
    hostPath: m.Type === "bind" ? m.Source : "",
    containerPath: m.Destination,
    name: m.Type === "volume" ? (m.Name ?? m.Source) : "",
    readOnly: !m.RW,
  }));

  const config = data.Config ?? {};
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
  const recreateBaseline = useMemo(() => ({
    ports: JSON.stringify(initialPorts),
    mounts: JSON.stringify(initialMounts),
    entrypoint: initialEntrypoint.join(" "),
    command: initialCmd.join(" "),
    workingDir: initialWorkdir,
    user: initialUser,
    hostname: initialHostname,
    labels: JSON.stringify(Object.entries(initialLabels).map(([k, v]) => ({ key: k, value: v }))),
  }), [containerId]);


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
      const combinedSwap = swapOnly === -1 ? -1 : swapOnly > 0 ? memBytes + swapOnly : memBytes > 0 ? memBytes * 2 : 0;
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
        restartPolicy, maxRetries, memoryMB, memSwapMB,
        cpuCount, cpuShares, pidsLimit,
      };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply settings");
    } finally {
      setLiveLoading(false);
    }
  }, [
    nodeId, containerId, restartPolicy, maxRetries, memoryMB, memSwapMB,
    cpuCount, cpuShares, pidsLimit, currentRestartPolicy, currentMaxRetries,
    currentMemory, currentMemSwap, currentNanoCPUs, currentCpuShares,
    currentPidsLimit, onAction,
  ]);

  // ── Recreate handler ──
  const handleRecreate = useCallback(async () => {
    const ok = await confirm({
      title: "Recreate Container",
      description: "This will stop and recreate the container with the new configuration. The container will experience downtime. Continue?",
      confirmLabel: "Recreate",
    });
    if (!ok) return;

    setRecreateLoading(true);
    try {
      const payload: Record<string, unknown> = {};
      // Only send fields that changed
      if (portsChanged) {
        payload.ports = ports.filter((p) => p.containerPort).map((p) => ({
          hostPort: Number(p.hostPort) || 0,
          containerPort: Number(p.containerPort),
          protocol: p.protocol,
        }));
      }
      if (mountsChanged) {
        payload.mounts = mounts.filter((m) => m.containerPath).map((m) => ({
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
  }, [nodeId, containerId, ports, mounts, entrypoint, command, workingDir, user, hostname, labels, onAction]);

  // ── Port helpers ──
  const addPort = () => setPorts((p) => [...p, { hostPort: "", containerPort: "", protocol: "tcp" }]);
  const removePort = (i: number) => setPorts((p) => p.filter((_, idx) => idx !== i));
  const updatePort = (i: number, field: keyof PortMapping, val: string) =>
    setPorts((p) => p.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

  // ── Mount helpers ──
  const addMount = () => setMounts((m) => [...m, { hostPath: "", containerPath: "", name: "", readOnly: false }]);
  const removeMount = (i: number) => setMounts((m) => m.filter((_, idx) => idx !== i));
  const updateMount = (i: number, field: keyof MountEntry, val: string | boolean) =>
    setMounts((m) => m.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

  // ── Label helpers ──
  const addLabel = () => setLabels((l) => [...l, { key: "", value: "" }]);
  const removeLabel = (i: number) => setLabels((l) => l.filter((_, idx) => idx !== i));
  const updateLabel = (i: number, field: "key" | "value", val: string) =>
    setLabels((l) => l.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

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
  const hasRecreateChanges = portsChanged || mountsChanged || execChanged || labelsChanged;

  // ── Shared input styles ──
  const inputCell = "h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className={`space-y-6 pb-6 ${recreateLoading || !!transition ? "pointer-events-none opacity-60" : ""}`}>
      {/* ─── Runtime Settings + Execution (side by side) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Runtime Settings</h3>
              <p className="text-xs text-muted-foreground">Applied instantly without restart</p>
            </div>
            {canEdit && (
              <Button size="sm" onClick={handleLiveUpdate} disabled={liveLoading || !hasRuntimeChanges}>
                <Save className="h-3.5 w-3.5" />
                Apply
              </Button>
            )}
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Restart Policy</label>
                <Select value={restartPolicy} onValueChange={setRestartPolicy} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="always">Always</SelectItem>
                    <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                    <SelectItem value="on-failure">On Failure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{restartPolicy === "on-failure" ? "Max Retries" : "PIDs Limit"}</label>
                {restartPolicy === "on-failure" ? (
                  <Input type="number" className="h-8 text-xs" value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} placeholder="0" disabled={!canEdit} min={0} />
                ) : (
                  <Input type="number" className="h-8 text-xs" value={pidsLimit} onChange={(e) => setPidsLimit(e.target.value)} placeholder="Unlimited" disabled={!canEdit} min={0} />
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Memory Limit (MB)</label>
                <Input type="number" className="h-8 text-xs" value={memoryMB} onChange={(e) => setMemoryMB(e.target.value)} placeholder="Unlimited" disabled={!canEdit} min={0} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Swap (MB)</label>
                <Input type="number" className="h-8 text-xs" value={memSwapMB} onChange={(e) => setMemSwapMB(e.target.value)} placeholder="-1 = unlimited, 0 = disabled" disabled={!canEdit} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">CPU Limit (cores)</label>
                <Input type="number" className="h-8 text-xs" value={cpuCount} onChange={(e) => setCpuCount(e.target.value)} placeholder="Unlimited" disabled={!canEdit} min={0} step={0.1} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">CPU Shares</label>
                <Input type="number" className="h-8 text-xs" value={cpuShares} onChange={(e) => setCpuShares(e.target.value)} placeholder="Default: 1024" disabled={!canEdit} min={0} />
              </div>
            </div>
            {restartPolicy === "on-failure" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">PIDs Limit</label>
                <Input type="number" className="h-8 text-xs" value={pidsLimit} onChange={(e) => setPidsLimit(e.target.value)} placeholder="Unlimited" disabled={!canEdit} min={0} />
              </div>
            )}
          </div>
        </div>

        <div className="border bg-card overflow-hidden" style={execChanged ? { borderColor: "rgb(234 179 8)" } : undefined}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Execution</h3>
              <p className="text-xs text-muted-foreground">Requires container recreation</p>
            </div>
            {canEdit && (
              <Button size="sm" style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }} className="hover:opacity-90 disabled:opacity-50" onClick={handleRecreate} disabled={recreateLoading || !hasRecreateChanges}>
                <RotateCcw className="h-3.5 w-3.5" />
                Recreate
              </Button>
            )}
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Entrypoint</label>
                <Input className="h-8 text-xs font-mono" value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="/docker-entrypoint.sh" disabled={!canEdit} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Working Directory</label>
                <Input className="h-8 text-xs font-mono" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder="/app" disabled={!canEdit} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">User</label>
                <Input className="h-8 text-xs font-mono" value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" disabled={!canEdit} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Hostname</label>
                <Input className="h-8 text-xs font-mono" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="container-hostname" disabled={!canEdit} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Command</label>
              <Input className="h-8 text-xs font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="nginx -g daemon off;" disabled={!canEdit} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Port Mappings ────────────────────────────────────────── */}
      <div className="border bg-card overflow-hidden" style={portsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Port Mappings</h3>
            <p className="text-xs text-muted-foreground">Requires container recreation</p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={addPort}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
        {ports.length > 0 ? (
          <>
            <div className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}>
              <div className="px-3 py-2">Host Port</div>
              <div className="px-3 py-2 border-l border-border">Container Port</div>
              <div className="px-3 py-2 border-l border-border">Protocol</div>
              {canEdit && <div />}
            </div>
            <div className="-mb-px">
            {ports.map((p, i) => (
              <div key={i} className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border last:border-b-0`}>
                <Input
                  type="number"
                  className={inputCell}
                  value={p.hostPort}
                  onChange={(e) => updatePort(i, "hostPort", e.target.value)}
                  placeholder="8080"
                  disabled={!canEdit}
                />
                <div className="border-l border-border">
                  <Input
                    type="number"
                    className={inputCell}
                    value={p.containerPort}
                    onChange={(e) => updatePort(i, "containerPort", e.target.value)}
                    placeholder="80"
                    disabled={!canEdit}
                  />
                </div>
                <div className="border-l border-border">
                  <Select value={p.protocol} onValueChange={(v) => updatePort(i, "protocol", v)} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-none border-l border-border" onClick={() => removePort(i)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No port mappings</div>
        )}
      </div>

      {/* ─── Volume Mounts ────────────────────────────────────────── */}
      <div className="border bg-card overflow-hidden" style={mountsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Volume Mounts</h3>
            <p className="text-xs text-muted-foreground">Requires container recreation</p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={addMount}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
        {mounts.length > 0 ? (
          <>
            <div className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}>
              <div className="px-3 py-2">Source</div>
              <div className="px-3 py-2 border-l border-border">Container Path</div>
              <div className="px-3 py-2 border-l border-border">Mode</div>
              {canEdit && <div />}
            </div>
            <div className="-mb-px">
            {mounts.map((m, i) => (
              <div key={i} className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border last:border-b-0`}>
                <Input
                  className={inputCell}
                  value={m.hostPath || m.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith("/")) {
                      updateMount(i, "hostPath", val);
                      updateMount(i, "name", "");
                    } else {
                      updateMount(i, "name", val);
                      updateMount(i, "hostPath", "");
                    }
                  }}
                  placeholder="/host/path or volume-name"
                  disabled={!canEdit}
                />
                <div className="border-l border-border">
                  <Input
                    className={inputCell}
                    value={m.containerPath}
                    onChange={(e) => updateMount(i, "containerPath", e.target.value)}
                    placeholder="/container/path"
                    disabled={!canEdit}
                  />
                </div>
                <div className="border-l border-border">
                  <Select value={m.readOnly ? "ro" : "rw"} onValueChange={(v) => updateMount(i, "readOnly", v === "ro")} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rw">RW</SelectItem>
                      <SelectItem value="ro">RO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-none border-l border-border" onClick={() => removeMount(i)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No volume mounts</div>
        )}
      </div>

      {/* ─── Labels ───────────────────────────────────────────────── */}
      <div className="border bg-card overflow-hidden" style={labelsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Labels</h3>
            <p className="text-xs text-muted-foreground">Requires container recreation</p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={addLabel}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
        {labels.length > 0 ? (
          <>
            <div className="grid grid-cols-[1fr_1fr] border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <div className="px-3 py-2">Key</div>
              <div className="px-3 py-2 border-l border-border">Value</div>
            </div>
            <div className="-mb-px">
            {labels.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] border-b border-border last:border-b-0">
                <Input
                  className={inputCell}
                  value={l.key}
                  onChange={(e) => updateLabel(i, "key", e.target.value)}
                  placeholder="com.example.key"
                  disabled={!canEdit}
                />
                <div className="flex items-center border-l border-border">
                  <Input
                    className={`${inputCell} flex-1 min-w-0`}
                    value={l.value}
                    onChange={(e) => updateLabel(i, "value", e.target.value)}
                    placeholder="value"
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-none border-l border-border" onClick={() => removeLabel(i)}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No labels</div>
        )}
      </div>

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
