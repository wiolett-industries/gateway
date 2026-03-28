import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Cpu,
  FlaskConical,
  HardDrive,
  Save,
  Server,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Sparkline } from "@/components/ui/sparkline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { NginxProcessInfo, NginxStatsSnapshot } from "@/types";

const MAX_HISTORY = 60;
// 30s window at 2s intervals = 15 data points back
const TREND_WINDOW = 15;

/** Convert cumulative counter history into 30s rolling throughput. */
function toRollingDelta(raw: number[]): number[] {
  if (raw.length < 2) return [];
  // Skip the first TREND_WINDOW points that would always be near-zero
  const start = Math.min(TREND_WINDOW, raw.length - 1);
  return raw.slice(start).map((val, i) => {
    const lookback = i + start - TREND_WINDOW;
    const prev = raw[Math.max(0, lookback)];
    return Math.max(0, val - prev);
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  history: number[];
  color?: string;
  subtitle?: string;
}

function StatCard({ label, value, icon: Icon, history, color = "var(--color-primary)", subtitle }: StatCardProps) {
  return (
    <div className="border border-border bg-card flex flex-col overflow-hidden">
      <div className="p-4 space-y-2 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-xl font-bold">{value}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
      {history.length >= 2 && (
        <Sparkline data={history} width={200} height={32} color={color} fillOpacity={0.1} className="w-full" />
      )}
    </div>
  );
}

export function NginxManagement() {
  const { hasRole } = useAuthStore();
  const isAdmin = hasRole("admin");

  // Monitoring state
  const [stats, setStats] = useState<NginxStatsSnapshot | null>(null);
  const [processInfo, setProcessInfo] = useState<NginxProcessInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const historyRef = useRef<Record<string, number[]>>({});

  // Config state
  const [configContent, setConfigContent] = useState("");
  const [originalConfig, setOriginalConfig] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [activeTab, setActiveTab] = useState("monitoring");

  const appendHistory = useCallback((key: string, value: number) => {
    const current = historyRef.current[key] || [];
    const next = [...current, value].slice(-MAX_HISTORY);
    historyRef.current[key] = next;
    return next;
  }, []);

  const processSnapshot = useCallback((snapshot: NginxStatsSnapshot) => {
    if (snapshot.stubStatus) {
      appendHistory("activeConnections", snapshot.stubStatus.activeConnections);
      appendHistory("reading", snapshot.stubStatus.reading);
      appendHistory("writing", snapshot.stubStatus.writing);
      appendHistory("waiting", snapshot.stubStatus.waiting);
      appendHistory("accepts_raw", snapshot.stubStatus.accepts);
      appendHistory("handled_raw", snapshot.stubStatus.handled);
      appendHistory("requests_raw", snapshot.stubStatus.requests);
    }
    if (snapshot.systemStats) {
      appendHistory("cpu", snapshot.systemStats.cpuUsagePercent);
      appendHistory("memory", snapshot.systemStats.memoryUsagePercent);
      appendHistory("networkRx", snapshot.systemStats.networkRxBytes);
      appendHistory("networkTx", snapshot.systemStats.networkTxBytes);
      appendHistory("diskRead", snapshot.systemStats.blockReadBytes);
      appendHistory("diskWrite", snapshot.systemStats.blockWriteBytes);
    }
    appendHistory("rps", snapshot.derived.requestsPerSec);
    appendHistory("cps", snapshot.derived.connectionsPerSec);
    if (snapshot.trafficStats) {
      appendHistory("s2xx", snapshot.trafficStats.statusCodes.s2xx);
      appendHistory("s3xx", snapshot.trafficStats.statusCodes.s3xx);
      appendHistory("s4xx", snapshot.trafficStats.statusCodes.s4xx);
      appendHistory("s5xx", snapshot.trafficStats.statusCodes.s5xx);
      appendHistory("avgRt", snapshot.trafficStats.avgResponseTime);
      appendHistory("p95Rt", snapshot.trafficStats.p95ResponseTime);
    }
  }, [appendHistory]);

  // SSE connection for monitoring
  useEffect(() => {
    if (activeTab !== "monitoring") return;

    const es = api.createNginxStatsStream();
    eventSourceRef.current = es;

    es.addEventListener("connected", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as {
        connected: boolean;
        info: NginxProcessInfo | null;
        history: NginxStatsSnapshot[];
      };
      setConnected(true);
      setUnavailable(false);
      if (data.info) setProcessInfo(data.info);
      if (data.history?.length > 0) {
        for (const snapshot of data.history) {
          processSnapshot(snapshot);
        }
        setStats(data.history[data.history.length - 1]);
      }
    });

    es.addEventListener("stats", (e: MessageEvent) => {
      const snapshot = JSON.parse(e.data) as NginxStatsSnapshot;
      setStats(snapshot);
      setConnected(true);
      setUnavailable(false);
      processSnapshot(snapshot);
    });

    es.onerror = () => {
      setConnected(false);
      if (es.readyState === EventSource.CLOSED) {
        setUnavailable(true);
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [activeTab, processSnapshot]);

  // Load config when switching to config tab
  useEffect(() => {
    if (activeTab !== "configuration") return;
    setConfigLoading(true);
    api
      .getNginxConfig()
      .then((content) => {
        setConfigContent(content);
        setOriginalConfig(content);
      })
      .catch(() => toast.error("Failed to load nginx config"))
      .finally(() => setConfigLoading(false));
  }, [activeTab]);

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await api.testNginxConfig();
      if (result.valid) {
        toast.success("nginx -t passed — configuration is valid");
      } else {
        toast.error(result.error || "nginx -t failed");
      }
    } catch {
      toast.error("Failed to test config");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await api.updateNginxConfig(configContent);
      if (result.valid) {
        toast.success("Config saved and nginx reloaded");
        setOriginalConfig(configContent);
      } else {
        toast.error(result.error || "Config test failed, changes rolled back");
      }
    } catch {
      toast.error("Failed to save config");
    } finally {
      setIsSaving(false);
    }
  };

  const h = historyRef.current;
  const stub = stats?.stubStatus;
  const sys = stats?.systemStats;
  const hasChanges = configContent !== originalConfig;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Nginx</h1>
            <p className="text-sm text-muted-foreground">
              Server monitoring and configuration
            </p>
          </div>
          {connected && (
            <Badge variant="success" className="text-xs">
              Connected
            </Badge>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="monitoring" className="space-y-4 mt-4">
            {unavailable && !connected ? (
              <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
                <Server className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Nginx container is not available</p>
                <p className="text-xs text-muted-foreground">
                  Start it with <code className="bg-muted px-1.5 py-0.5">pnpm dev:infra</code>
                </p>
              </div>
            ) : (
              <>
                {/* Process Info */}
                {processInfo && (
                  <div className="flex flex-wrap items-center gap-3 p-3 border border-border bg-card text-sm">
                    <span className="font-medium">nginx/{processInfo.version}</span>
                    <Badge variant="secondary" className="text-xs">
                      {processInfo.workerCount} workers
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Up {formatUptime(processInfo.uptimeSeconds)}
                    </Badge>
                    <Badge
                      variant={processInfo.configValid ? "success" : "destructive"}
                      className="text-xs"
                    >
                      {processInfo.configValid ? "Config valid" : "Config invalid"}
                    </Badge>
                  </div>
                )}

                {/* Connection Stats */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 mt-4 text-muted-foreground">Connections</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <StatCard
                      label="Active"
                      value={String(stub?.activeConnections ?? 0)}
                      icon={Activity}
                      history={h.activeConnections || []}
                      color="hsl(var(--primary))"
                    />
                    <StatCard
                      label="Requests/sec"
                      value={String(stats?.derived.requestsPerSec ?? 0)}
                      icon={Activity}
                      history={h.rps || []}
                      color="#10b981"
                    />
                    <StatCard
                      label="Conn/sec"
                      value={String(stats?.derived.connectionsPerSec ?? 0)}
                      icon={Activity}
                      history={h.cps || []}
                      color="#f59e0b"
                    />
                    <StatCard
                      label="Reading"
                      value={String(stub?.reading ?? 0)}
                      icon={ArrowDownToLine}
                      history={h.reading || []}
                      color="#22c55e"
                    />
                    <StatCard
                      label="Writing"
                      value={String(stub?.writing ?? 0)}
                      icon={ArrowUpFromLine}
                      history={h.writing || []}
                      color="#f59e0b"
                    />
                    <StatCard
                      label="Waiting"
                      value={String(stub?.waiting ?? 0)}
                      icon={Server}
                      history={h.waiting || []}
                      color="#6b7280"
                    />
                  </div>
                </div>

                {/* System Resources */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 mt-4 text-muted-foreground">Resources</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <StatCard
                      label="CPU"
                      value={`${sys?.cpuUsagePercent.toFixed(1) ?? "0"}%`}
                      icon={Cpu}
                      history={h.cpu || []}
                      color="#3b82f6"
                    />
                    <StatCard
                      label="Memory"
                      value={sys ? formatBytes(sys.memoryUsageBytes) : "0 B"}
                      icon={Server}
                      history={h.memory || []}
                      color="#8b5cf6"
                      subtitle={sys ? `${sys.memoryUsagePercent.toFixed(1)}% of ${formatBytes(sys.memoryLimitBytes)}` : undefined}
                    />
                    <StatCard
                      label="Network I/O"
                      value={sys ? `${formatBytes(sys.networkRxBytes)} / ${formatBytes(sys.networkTxBytes)}` : "0 B"}
                      icon={Activity}
                      history={h.networkRx || []}
                      color="#06b6d4"
                      subtitle="Rx / Tx total"
                    />
                    <StatCard
                      label="Disk I/O"
                      value={sys ? `${formatBytes(sys.blockReadBytes)} / ${formatBytes(sys.blockWriteBytes)}` : "0 B"}
                      icon={HardDrive}
                      history={h.diskRead || []}
                      color="#f97316"
                      subtitle="Read / Write total"
                    />
                  </div>
                </div>

                {/* Traffic — Status Codes & Response Times */}
                {stats?.trafficStats && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 mt-4 text-muted-foreground">Traffic</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      <StatCard
                        label="2xx Success"
                        value={String(stats.trafficStats.statusCodes.s2xx)}
                        icon={Check}
                        history={toRollingDelta(h.s2xx || [])}
                        color="#22c55e"
                      />
                      <StatCard
                        label="3xx Redirect"
                        value={String(stats.trafficStats.statusCodes.s3xx)}
                        icon={Activity}
                        history={toRollingDelta(h.s3xx || [])}
                        color="#3b82f6"
                      />
                      <StatCard
                        label="4xx Client Err"
                        value={String(stats.trafficStats.statusCodes.s4xx)}
                        icon={X}
                        history={toRollingDelta(h.s4xx || [])}
                        color="#f59e0b"
                      />
                      <StatCard
                        label="5xx Server Err"
                        value={String(stats.trafficStats.statusCodes.s5xx)}
                        icon={X}
                        history={toRollingDelta(h.s5xx || [])}
                        color="#ef4444"
                      />
                      <StatCard
                        label="Avg Response"
                        value={`${(stats.trafficStats.avgResponseTime * 1000).toFixed(0)}ms`}
                        icon={Activity}
                        history={(h.avgRt || []).map((v) => v * 1000)}
                        color="#8b5cf6"
                      />
                      <StatCard
                        label="p95 Response"
                        value={`${(stats.trafficStats.p95ResponseTime * 1000).toFixed(0)}ms`}
                        icon={Activity}
                        history={(h.p95Rt || []).map((v) => v * 1000)}
                        color="#ec4899"
                      />
                    </div>
                  </div>
                )}

                {/* Cumulative Counters */}
                {stub && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 mt-4 text-muted-foreground">Totals (30s trend)</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <StatCard
                        label="Accepts"
                        value={stub.accepts.toLocaleString()}
                        icon={Activity}
                        history={toRollingDelta(h.accepts_raw || [])}
                        color="#22c55e"
                        subtitle="per 30s window"
                      />
                      <StatCard
                        label="Handled"
                        value={stub.handled.toLocaleString()}
                        icon={Activity}
                        history={toRollingDelta(h.handled_raw || [])}
                        color="#3b82f6"
                        subtitle="per 30s window"
                      />
                      <StatCard
                        label="Requests"
                        value={stub.requests.toLocaleString()}
                        icon={Activity}
                        history={toRollingDelta(h.requests_raw || [])}
                        color="#8b5cf6"
                        subtitle="per 30s window"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="configuration" className="space-y-3 mt-4">
            {configLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Editor — viewport height minus header/tabs/padding/buttons */}
                <div className="border border-border" style={{ height: "calc(100vh - 217px)" }}>
                  <CodeEditor
                    value={configContent}
                    onChange={isAdmin ? setConfigContent : () => {}}
                    readOnly={!isAdmin}
                    height="100%"
                  />
                </div>

                {/* Bottom bar — test result + actions */}
                <div className="flex items-center justify-end gap-2 mt-3">
                  {!isAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Read-only — admin role required to edit
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={isTesting}
                  >
                    <FlaskConical className="h-4 w-4" />
                    {isTesting ? "Testing..." : "Test"}
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={isSaving || !hasChanges}
                    >
                      <Save className="h-4 w-4" />
                      {isSaving ? "Saving..." : "Save & Reload"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
