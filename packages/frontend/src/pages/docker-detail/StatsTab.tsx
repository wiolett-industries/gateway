import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { api } from "@/services/api";
import { formatBytes, type InspectData } from "./helpers";

const MAX_HISTORY = 30;

interface ContainerStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

function normalizeStats(raw: Record<string, any>): ContainerStats {
  return {
    cpuPercent: raw.cpuPercent ?? raw.cpu_percent ?? 0,
    memoryUsageBytes: raw.memoryUsageBytes ?? raw.memory_usage_bytes ?? 0,
    memoryLimitBytes: raw.memoryLimitBytes ?? raw.memory_limit_bytes ?? 0,
    networkRxBytes: raw.networkRxBytes ?? raw.network_rx_bytes ?? 0,
    networkTxBytes: raw.networkTxBytes ?? raw.network_tx_bytes ?? 0,
    blockReadBytes: raw.blockReadBytes ?? raw.block_read_bytes ?? 0,
    blockWriteBytes: raw.blockWriteBytes ?? raw.block_write_bytes ?? 0,
    pids: raw.pids ?? 0,
  };
}

export function StatsTab({
  nodeId,
  containerId,
  data,
}: {
  nodeId: string;
  containerId: string;
  data: InspectData;
}) {
  const [current, setCurrent] = useState<ContainerStats | null>(null);
  const [processes, setProcesses] = useState<{ Titles: string[]; Processes: string[][] } | null>(
    null
  );

  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [netRxHist, setNetRxHist] = useState<number[]>([]);
  const [netTxHist, setNetTxHist] = useState<number[]>([]);
  const [diskReadHist, setDiskReadHist] = useState<number[]>([]);
  const [diskWriteHist, setDiskWriteHist] = useState<number[]>([]);
  const [pidsHist, setPidsHist] = useState<number[]>([]);
  const prevCountersRef = useRef<{
    netRx: number;
    netTx: number;
    diskR: number;
    diskW: number;
  } | null>(null);

  const pushStats = useCallback((s: ContainerStats) => {
    setCurrent(s);
    setCpuHist((prev) => [...prev.slice(-(MAX_HISTORY - 1)), s.cpuPercent]);
    setMemHist((prev) => [...prev.slice(-(MAX_HISTORY - 1)), s.memoryUsageBytes]);
    setPidsHist((prev) => [...prev.slice(-(MAX_HISTORY - 1)), s.pids]);

    const pc = prevCountersRef.current;
    if (pc) {
      setNetRxHist((h) => [
        ...h.slice(-(MAX_HISTORY - 1)),
        Math.max(0, s.networkRxBytes - pc.netRx),
      ]);
      setNetTxHist((h) => [
        ...h.slice(-(MAX_HISTORY - 1)),
        Math.max(0, s.networkTxBytes - pc.netTx),
      ]);
      setDiskReadHist((h) => [
        ...h.slice(-(MAX_HISTORY - 1)),
        Math.max(0, s.blockReadBytes - pc.diskR),
      ]);
      setDiskWriteHist((h) => [
        ...h.slice(-(MAX_HISTORY - 1)),
        Math.max(0, s.blockWriteBytes - pc.diskW),
      ]);
    }
    prevCountersRef.current = {
      netRx: s.networkRxBytes,
      netTx: s.networkTxBytes,
      diskR: s.blockReadBytes,
      diskW: s.blockWriteBytes,
    };
  }, []);

  // Load history from Redis on mount, then connect to SSE
  useEffect(() => {
    // 1. Load saved history
    api
      .getContainerStatsHistory(nodeId, containerId)
      .then((history) => {
        if (!history || history.length === 0) return;
        const cpus: number[] = [],
          mems: number[] = [],
          pidsList: number[] = [];
        const rxD: number[] = [],
          txD: number[] = [],
          drD: number[] = [],
          dwD: number[] = [];
        let pRx = 0,
          pTx = 0,
          pDR = 0,
          pDW = 0;
        for (let i = 0; i < history.length; i++) {
          const s = normalizeStats(history[i] as any);
          cpus.push(s.cpuPercent);
          mems.push(s.memoryUsageBytes);
          pidsList.push(s.pids);
          if (i > 0) {
            rxD.push(Math.max(0, s.networkRxBytes - pRx));
            txD.push(Math.max(0, s.networkTxBytes - pTx));
            drD.push(Math.max(0, s.blockReadBytes - pDR));
            dwD.push(Math.max(0, s.blockWriteBytes - pDW));
          }
          pRx = s.networkRxBytes;
          pTx = s.networkTxBytes;
          pDR = s.blockReadBytes;
          pDW = s.blockWriteBytes;
        }
        setCpuHist(cpus);
        setMemHist(mems);
        setPidsHist(pidsList);
        setNetRxHist(rxD);
        setNetTxHist(txD);
        setDiskReadHist(drD);
        setDiskWriteHist(dwD);
        prevCountersRef.current = { netRx: pRx, netTx: pTx, diskR: pDR, diskW: pDW };
        const last = normalizeStats(history[history.length - 1] as any);
        setCurrent(last);
      })
      .catch(() => {
        /* ignore */
      });

    // 2. Connect to node monitoring SSE (reuse existing stream)
    const es = api.createNodeMonitoringStream(nodeId);

    const findContainerStats = (snapshot: any): ContainerStats | null => {
      const stats = snapshot?.health?.containerStats as any[] | undefined;
      if (!stats) return null;
      const match = stats.find((s: any) => (s.containerId ?? s.container_id) === containerId);
      return match ? normalizeStats(match) : null;
    };

    es.addEventListener("connected", (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      // Extract container stats from history snapshots
      if (msg.history) {
        for (const snap of msg.history as any[]) {
          const s = findContainerStats(snap);
          if (s) pushStats(s);
        }
      }
    });

    es.addEventListener("snapshot", (e: MessageEvent) => {
      const snapshot = JSON.parse(e.data);
      const s = findContainerStats(snapshot);
      if (s) pushStats(s);
    });

    return () => es.close();
  }, [nodeId, containerId, pushStats]);

  // Fetch process list (separate from SSE — needs direct call)
  useEffect(() => {
    const fetchTop = async () => {
      try {
        const p = await api.getContainerTop(nodeId, containerId);
        setProcesses(p as any);
      } catch {
        /* */
      }
    };
    fetchTop();
    const interval = setInterval(fetchTop, 10000);
    return () => clearInterval(interval);
  }, [nodeId, containerId]);

  // Uptime — ticks every second
  const state = data.State ?? {};
  const isRunning = state.Running === true || state.Status === "running";
  const startedAt = state.StartedAt ? new Date(state.StartedAt).getTime() : 0;

  const formatUptime = useCallback(() => {
    if (!startedAt || !isRunning) return "-";
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    if (secs < 0) return "-";
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }, [startedAt, isRunning]);

  const [uptime, setUptime] = useState(formatUptime);
  useEffect(() => {
    setUptime(formatUptime());
    const tick = setInterval(() => setUptime(formatUptime()), 1000);
    return () => clearInterval(tick);
  }, [formatUptime]);

  const cpuPercent = current?.cpuPercent ?? 0;
  const memUsage = current?.memoryUsageBytes ?? 0;
  const memLimit = current?.memoryLimitBytes ?? 0;
  const netRx = current?.networkRxBytes ?? 0;
  const netTx = current?.networkTxBytes ?? 0;
  const blockRead = current?.blockReadBytes ?? 0;
  const blockWrite = current?.blockWriteBytes ?? 0;
  const pids = current?.pids ?? 0;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  // Filter out TTY column from process list
  const ttIdx = processes?.Titles?.findIndex((t) => t === "TTY" || t === "TT") ?? -1;
  const filteredTitles = processes?.Titles?.filter((_, i) => i !== ttIdx) ?? [];
  const filteredProcesses =
    processes?.Processes?.map((row) => row.filter((_, i) => i !== ttIdx)) ?? [];

  return (
    <div className="space-y-6 pb-6">
      {!isRunning && (
        <div className="py-8 text-center text-muted-foreground">
          Container is not running. Start it to see monitoring data.
        </div>
      )}

      {isRunning && (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard
              label="CPU"
              value={`${cpuPercent.toFixed(1)}%`}
              icon={Cpu}
              history={cpuHist}
              sparklineMax={100}
              color="#3b82f6"
              progress={{ percent: cpuPercent }}
            />
            <StatCard
              label="Memory"
              value={formatBytes(memUsage)}
              icon={MemoryStick}
              history={memHist}
              sparklineMax={memLimit || undefined}
              color="#8b5cf6"
              progress={{ percent: memPercent }}
              subtitle={`${memPercent.toFixed(0)}% of ${formatBytes(memLimit)}`}
            />
            <StatCard
              label="Network RX"
              value={formatBytes(netRx)}
              icon={ArrowDownToLine}
              history={netRxHist}
              color="#22c55e"
            />
            <StatCard
              label="Network TX"
              value={formatBytes(netTx)}
              icon={ArrowUpFromLine}
              history={netTxHist}
              color="#f59e0b"
            />
            <StatCard
              label="Disk Read"
              value={formatBytes(blockRead)}
              icon={HardDrive}
              history={diskReadHist}
              color="#06b6d4"
            />
            <StatCard
              label="Disk Write"
              value={formatBytes(blockWrite)}
              icon={HardDrive}
              history={diskWriteHist}
              color="#f43f5e"
            />
            <StatCard
              label="PIDs"
              value={String(pids)}
              icon={Users}
              history={pidsHist}
              color="#64748b"
            />
            <StatCard label="Uptime" value={uptime} icon={Clock} color="#a855f7" />
          </div>

          {/* Process List */}
          {filteredProcesses.length > 0 && (
            <div className="border border-border bg-card">
              <div className="border-b border-border p-4">
                <h4 className="text-sm font-semibold">Process List</h4>
              </div>
              <div className="overflow-x-auto">
                <div className="max-h-[calc(2rem*9+2.25rem+4px)] overflow-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="text-left border-b border-border">
                        {filteredTitles.map((title) => (
                          <th
                            key={title}
                            className="p-2 px-4 text-xs font-medium text-muted-foreground uppercase"
                          >
                            {title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredProcesses.map((proc, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          {proc.map((val, j) => (
                            <td key={j} className="p-2 px-4 text-xs font-mono">
                              {val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
