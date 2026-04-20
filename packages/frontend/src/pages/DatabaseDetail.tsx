import {
  Activity,
  ArrowLeft,
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  KeyRound,
  Loader2,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { DetailRow } from "@/components/common/DetailRow";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { DataTable } from "@/components/ui/data-table";
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
import { StatCard } from "@/components/ui/stat-card";
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
import { formatBytes } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  DatabaseConnection,
  DatabaseMetricSnapshot,
  PostgresTableColumn,
  PostgresTableMetadata,
  RedisKeyRecord,
} from "@/types";
import {
  buildDatabasePayload,
  DatabaseConnectionForm,
  draftFromConnection,
  type DatabaseConnectionDraft,
} from "./database-detail/DatabaseConnectionForm";

const HEALTH_BADGE: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  online: "success",
  degraded: "warning",
  offline: "destructive",
  unknown: "secondary",
};

const METRIC_COLORS: Record<string, string> = {
  latency_ms: "#f97316",
  active_connections: "#0891b2",
  total_connections: "#0891b2",
  idle_connections: "#64748b",
  max_connections: "#64748b",
  active_connections_pct: "#f59e0b",
  total_connections_pct: "#f59e0b",
  database_size_bytes: "#2563eb",
  lock_count: "#ef4444",
  long_running_queries: "#f97316",
  transaction_rate: "#10b981",
  cache_hit_ratio: "#2563eb",
  read_blocks_per_sec: "#0891b2",
  write_blocks_per_sec: "#f59e0b",
  used_memory_bytes: "#2563eb",
  maxmemory_bytes: "#64748b",
  memory_pct: "#f59e0b",
  connected_clients: "#0891b2",
  instantaneous_ops_per_sec: "#10b981",
  key_count: "#10b981",
  redis_db: "#64748b",
};

const POSTGRES_EXPLORER_PAGE_SIZE = 100;
const VIRTUAL_ROW_HEIGHT = 37;
const VIRTUAL_RESULT_ROW_HEIGHT = 49;

function formatMetricValue(key: string, value: number | null): string {
  if (value == null) return "-";
  if (key.includes("bytes")) return formatBytes(value);
  if (key.endsWith("_pct")) return `${value.toFixed(1)}%`;
  if (key.endsWith("_ms")) return `${value.toFixed(0)} ms`;
  if (key === "transaction_rate") return `${value.toFixed(1)}/s`;
  if (key === "cache_hit_ratio") return `${value.toFixed(1)}%`;
  if (key === "read_blocks_per_sec" || key === "write_blocks_per_sec") {
    return `${value.toFixed(1)}/s`;
  }
  return `${value}`;
}

function formatHealthStatusLabel(
  status: DatabaseConnection["healthStatus"] | "unknown"
): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isNumericColumn(column: PostgresTableColumn): boolean {
  return (
    column.dataType.includes("integer") ||
    column.dataType.includes("numeric") ||
    column.dataType.includes("double") ||
    column.dataType.includes("real") ||
    column.dataType.includes("decimal")
  );
}

function isBooleanColumn(column: PostgresTableColumn): boolean {
  return column.dataType === "boolean";
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isBlankValue(value: unknown): boolean {
  return value == null || value === "";
}

function isPendingRowValid(
  row: Record<string, unknown>,
  columns: PostgresTableColumn[]
): boolean {
  const hasAnyValue = columns.some((column) => !isBlankValue(row[column.name]));
  if (!hasAnyValue) return false;

  return columns.every((column) => {
    if (column.nullable || column.hasDefault) return true;
    return !isBlankValue(row[column.name]);
  });
}

function getPendingRowState(
  row: Record<string, unknown>,
  columns: PostgresTableColumn[]
): "empty" | "valid" | "invalid" {
  const hasAnyValue = columns.some((column) => !isBlankValue(row[column.name]));
  if (!hasAnyValue) return "empty";
  return isPendingRowValid(row, columns) ? "valid" : "invalid";
}

function coerceCellInput(column: PostgresTableColumn, raw: string): unknown {
  if (raw === "") return null;
  if (isBooleanColumn(column)) {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
    return raw;
  }
  if (isNumericColumn(column) && !Number.isNaN(Number(raw))) return Number(raw);
  if (column.dataType === "json" || column.dataType === "jsonb") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function getRowKey(metadata: PostgresTableMetadata, row: Record<string, unknown>): string {
  if (metadata.primaryKey.length > 0) {
    return metadata.primaryKey.map((key) => String(row[key] ?? "")).join(":");
  }
  return JSON.stringify(row);
}

function buildPrimaryKey(metadata: PostgresTableMetadata, row: Record<string, unknown>) {
  return Object.fromEntries(metadata.primaryKey.map((key) => [key, row[key]]));
}

export function DatabaseDetail() {
  const { id } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const [database, setDatabase] = useState<DatabaseConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveHealthHistory, setLiveHealthHistory] = useState<DatabaseConnection["healthHistory"]>([]);
  const [liveHealthStatus, setLiveHealthStatus] = useState<DatabaseConnection["healthStatus"]>("unknown");
  const [monitoringHistory, setMonitoringHistory] = useState<DatabaseMetricSnapshot[]>([]);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revealedCredentials, setRevealedCredentials] = useState<Record<string, unknown> | null>(
    null
  );
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const canEdit = !!(id && (hasScope("databases:edit") || hasScope(`databases:edit:${id}`)));
  const canDelete = !!(id && (hasScope("databases:delete") || hasScope(`databases:delete:${id}`)));
  const canRead = !!(id && (hasScope("databases:query:read") || hasScope(`databases:query:read:${id}`)));
  const canWrite = !!(id && (hasScope("databases:query:write") || hasScope(`databases:query:write:${id}`)));
  const canAdmin = !!(id && (hasScope("databases:query:admin") || hasScope(`databases:query:admin:${id}`)));
  const canReveal = !!(
    id &&
    (hasScope("databases:credentials:reveal") || hasScope(`databases:credentials:reveal:${id}`))
  );
  const canViewMonitoring = !!(
    id &&
    (hasScope("databases:monitoring:view") || hasScope(`databases:monitoring:view:${id}`))
  );

  const [activeTab, setActiveTab] = useUrlTab(
    ["overview", "explorer", "console"],
    "overview",
    (tab) => `/databases/${id}/${tab}`
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDatabase(await api.getDatabase(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load database");
      navigate("/databases");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!database) return;
    setLiveHealthHistory(database.healthHistory ?? []);
    setLiveHealthStatus(database.healthStatus);
    setMonitoringHistory([]);
  }, [database]);

  useEffect(() => {
    if (!database || !canViewMonitoring) return;
    const es = api.createDatabaseMonitoringStream(database.id);
    es.addEventListener("connected", (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      setMonitoringHistory(message.history ?? []);
      setLiveHealthHistory(message.healthHistory ?? database.healthHistory ?? []);
      setLiveHealthStatus(message.healthStatus ?? database.healthStatus);
    });
    es.addEventListener("snapshot", (event: MessageEvent) => {
      const snapshot = JSON.parse(event.data) as DatabaseMetricSnapshot;
      setMonitoringHistory((prev) => [...prev, snapshot].slice(-60));
      setLiveHealthStatus(snapshot.status);
    });
    return () => es.close();
  }, [canViewMonitoring, database]);

  useRealtime(id ? "database.changed" : null, (payload) => {
    const event = payload as {
      id?: string;
      action?: string;
      healthStatus?: DatabaseConnection["healthStatus"];
      sampledAt?: string;
    };
    if (!event || event.id !== id) return;
    if (event.action === "deleted") {
      navigate("/databases");
      return;
    }
    if (event.action === "health.sampled") {
      if (event.healthStatus) setLiveHealthStatus(event.healthStatus);
      if (event.sampledAt && event.healthStatus) {
        setLiveHealthHistory((prev) => [...prev, { ts: event.sampledAt!, status: event.healthStatus! }]);
      }
      return;
    }
    if (event.action === "health.online" || event.action === "health.degraded" || event.action === "health.offline") {
      if (event.healthStatus) setLiveHealthStatus(event.healthStatus);
      return;
    }
    if (event.action === "data.updated" || event.action === "query.executed") {
      return;
    }
    void load();
  });

  const remove = async () => {
    if (!id || !database) return;
    const ok = await confirm({
      title: "Delete Database",
      description: `Delete saved connection "${database.name}"?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.deleteDatabase(id);
      toast.success("Database deleted");
      navigate("/databases");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete database");
    }
  };

  const testConnection = async () => {
    if (!canEdit || !database) return;
    try {
      const result = await api.testDatabase(database.id);
      toast.success(`Connection OK in ${result.responseMs} ms`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed");
    }
  };

  const revealCredentials = async () => {
    if (!database || !canReveal) return;
    setCredentialsOpen(true);
    if (revealedCredentials) return;
    setLoadingCredentials(true);
    try {
      setRevealedCredentials(await api.revealDatabaseCredentials(database.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reveal credentials");
    } finally {
      setLoadingCredentials(false);
    }
  };

  if (loading || !database) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner className="" />
      </div>
    );
  }

  const isFullHeightTab = activeTab === "explorer" || activeTab === "console";

  return (
    <PageTransition>
      <div
        className={`h-full p-6 flex flex-col gap-4 ${
          isFullHeightTab ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/databases")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{database.name}</h1>
                <Badge variant={HEALTH_BADGE[liveHealthStatus] ?? "secondary"}>
                  {formatHealthStatusLabel(liveHealthStatus)}
                </Badge>
                <Badge variant="secondary">{database.type}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {database.host}:{database.port}
                {database.databaseName ? ` · ${database.databaseName}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="outline" onClick={() => void testConnection()}>
                <RefreshCw className="h-4 w-4" />
                Test
              </Button>
            )}
            {(canEdit || canReveal || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                      <Settings className="h-3.5 w-3.5 mr-2" />
                      Settings
                    </DropdownMenuItem>
                  )}
                  {canEdit && (canReveal || canDelete) && <DropdownMenuSeparator />}
                  {canReveal && (
                    <DropdownMenuItem onClick={() => void revealCredentials()}>
                      <KeyRound className="h-3.5 w-3.5 mr-2" />
                      Reveal credentials
                    </DropdownMenuItem>
                  )}
                  {canReveal && canDelete && <DropdownMenuSeparator />}
                  {canDelete && (
                    <DropdownMenuItem onClick={() => void remove()} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <HealthBars
          history={liveHealthHistory}
          currentStatus={liveHealthStatus}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {canRead && <TabsTrigger value="explorer">Explorer</TabsTrigger>}
            {(canRead || canWrite || canAdmin) && <TabsTrigger value="console">Console</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <OverviewTab
              database={database}
              canViewMonitoring={canViewMonitoring}
              healthStatus={liveHealthStatus}
              history={monitoringHistory}
            />
          </TabsContent>
          {canRead && (
            <TabsContent value="explorer" className="flex flex-col flex-1 min-h-0">
              <ExplorerTab database={database} canWrite={canWrite || canAdmin} />
            </TabsContent>
          )}
          {(canRead || canWrite || canAdmin) && (
            <TabsContent value="console" className="space-y-4 flex flex-col flex-1 min-h-0">
              <ConsoleTab database={database} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <Dialog open={credentialsOpen} onOpenChange={setCredentialsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Stored Credentials</DialogTitle>
          </DialogHeader>
          <div className="border border-border bg-card overflow-hidden">
            {loadingCredentials ? (
              <div className="p-6 text-sm text-muted-foreground">Revealing credentials...</div>
            ) : (
              <pre className="overflow-x-auto p-4 text-sm whitespace-pre-wrap">
                {revealedCredentials
                  ? JSON.stringify(revealedCredentials, null, 2)
                  : "Credentials are hidden."}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {canEdit && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Database Settings</DialogTitle>
            </DialogHeader>
            <SettingsTab
              database={database}
              onSaved={() => {
                setSettingsOpen(false);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </PageTransition>
  );
}

function OverviewTab({
  database,
  canViewMonitoring,
  healthStatus,
  history,
}: {
  database: DatabaseConnection;
  canViewMonitoring: boolean;
  healthStatus: DatabaseConnection["healthStatus"];
  history: DatabaseMetricSnapshot[];
}) {
  const latest = history.at(-1);
  const overviewMetrics = useMemo<
    Array<{
      key: string;
      label: string;
      value: string;
      history: number[];
      progress?: { percent: number; color?: string };
      sparklineMax?: number;
      subtitle?: string;
    }>
  >(() => {
    if (!latest) return [];

    if (database.type === "postgres") {
      const active = latest.metrics.active_connections ?? null;
      const total = latest.metrics.total_connections ?? null;
      const max = latest.metrics.max_connections ?? null;
      const pct = latest.metrics.total_connections_pct ?? null;
      const lockCount = latest.metrics.lock_count ?? null;
      const longRunning = latest.metrics.long_running_queries ?? null;
      const transactionRate = latest.metrics.transaction_rate ?? null;
      const cacheHitRatio = latest.metrics.cache_hit_ratio ?? null;
      const readBlocksPerSec = latest.metrics.read_blocks_per_sec ?? null;
      const writeBlocksPerSec = latest.metrics.write_blocks_per_sec ?? null;
      const databaseSizeBytes = latest.metrics.database_size_bytes ?? null;
      const sizeLimitBytes =
        database.manualSizeLimitMb != null ? database.manualSizeLimitMb * 1024 * 1024 : null;
      const databaseSizePct =
        databaseSizeBytes != null && sizeLimitBytes && sizeLimitBytes > 0
          ? (databaseSizeBytes / sizeLimitBytes) * 100
          : null;
      return [
        {
          key: "latency_ms",
          label: "Latency",
          value: formatMetricValue("latency_ms", latest.metrics.latency_ms ?? null),
          history: history.map((item) => item.metrics.latency_ms ?? 0),
          progress: undefined,
          sparklineMax: undefined,
          subtitle: undefined,
        },
        {
          key: "total_connections",
          label: "Connections",
          value:
            total == null
              ? "-"
              : max && max > 0
                ? `${total} / ${max}`
                : `${total}`,
          history: history.map((item) => item.metrics.total_connections_pct ?? 0),
          progress:
            pct == null
              ? undefined
              : {
                  percent: pct,
                },
          sparklineMax: 100,
          subtitle:
            pct == null
              ? active == null
                ? undefined
                : `${active} active`
              : `${pct.toFixed(1)}% used${active == null ? "" : `, ${active} active`}`,
        },
        {
          key: "database_size_bytes",
          label: "Database Size",
          value:
            databaseSizeBytes == null
              ? "-"
              : sizeLimitBytes && sizeLimitBytes > 0
                ? `${formatBytes(databaseSizeBytes)} / ${formatBytes(sizeLimitBytes)}`
                : formatMetricValue("database_size_bytes", databaseSizeBytes),
          history: history.map((item) => item.metrics.database_size_bytes ?? 0),
          progress:
            databaseSizePct == null
              ? undefined
              : {
                  percent: databaseSizePct,
                },
          sparklineMax: undefined,
          subtitle:
            databaseSizePct == null ? undefined : `${databaseSizePct.toFixed(1)}% used`,
        },
        {
          key: "lock_count",
          label: "Lock Count",
          value: formatMetricValue("lock_count", lockCount),
          history: history.map((item) => item.metrics.lock_count ?? 0),
          progress: undefined,
          sparklineMax: undefined,
          subtitle: undefined,
        },
        {
          key: "long_running_queries",
          label: "Long-Running Queries",
          value: formatMetricValue("long_running_queries", longRunning),
          history: history.map((item) => item.metrics.long_running_queries ?? 0),
          progress: undefined,
          sparklineMax: undefined,
          subtitle: undefined,
        },
        {
          key: "transaction_rate",
          label: "Transaction Rate",
          value: formatMetricValue("transaction_rate", transactionRate),
          history: history.map((item) => item.metrics.transaction_rate ?? 0),
          progress: undefined,
          sparklineMax: undefined,
          subtitle: undefined,
        },
        {
          key: "cache_hit_ratio",
          label: "Cache Hit Ratio",
          value: formatMetricValue("cache_hit_ratio", cacheHitRatio),
          history: history.map((item) => item.metrics.cache_hit_ratio ?? 0),
          progress:
            cacheHitRatio == null
              ? undefined
              : {
                  percent: cacheHitRatio,
                },
          sparklineMax: 100,
          subtitle: undefined,
        },
        {
          key: "read_blocks_per_sec",
          label: "Read vs Write Blocks",
          value:
            readBlocksPerSec == null && writeBlocksPerSec == null
              ? "-"
              : `${formatMetricValue("read_blocks_per_sec", readBlocksPerSec)} / ${formatMetricValue("write_blocks_per_sec", writeBlocksPerSec)}`,
          history: history.map(
            (item) =>
              (item.metrics.read_blocks_per_sec ?? 0) + (item.metrics.write_blocks_per_sec ?? 0)
          ),
          progress: undefined,
          sparklineMax: undefined,
          subtitle: "read / write per sec",
        },
      ];
    }

    const usedMemory = latest.metrics.used_memory_bytes ?? null;
    const maxMemory = latest.metrics.maxmemory_bytes ?? null;
    const memoryPct = latest.metrics.memory_pct ?? null;
    return [
      {
        key: "latency_ms",
        label: "Latency",
        value: formatMetricValue("latency_ms", latest.metrics.latency_ms ?? null),
        history: history.map((item) => item.metrics.latency_ms ?? 0),
        progress: undefined,
        sparklineMax: undefined,
        subtitle: undefined,
      },
      {
        key: "used_memory_bytes",
        label: "Memory",
        value:
          usedMemory == null
            ? "-"
            : maxMemory && maxMemory > 0
              ? `${formatBytes(usedMemory)} / ${formatBytes(maxMemory)}`
              : formatBytes(usedMemory),
        history: history.map((item) => item.metrics.memory_pct ?? 0),
        progress:
          memoryPct == null
            ? undefined
            : {
                percent: memoryPct,
              },
        sparklineMax: 100,
        subtitle: memoryPct == null ? undefined : `${memoryPct.toFixed(1)}% used`,
      },
      {
        key: "connected_clients",
        label: "Connected Clients",
        value: formatMetricValue("connected_clients", latest.metrics.connected_clients ?? null),
        history: history.map((item) => item.metrics.connected_clients ?? 0),
        progress: undefined,
        sparklineMax: undefined,
        subtitle: undefined,
      },
      {
        key: "instantaneous_ops_per_sec",
        label: "Ops / Sec",
        value: formatMetricValue(
          "instantaneous_ops_per_sec",
          latest.metrics.instantaneous_ops_per_sec ?? null
        ),
        history: history.map((item) => item.metrics.instantaneous_ops_per_sec ?? 0),
        progress: undefined,
        sparklineMax: undefined,
        subtitle: undefined,
      },
    ];
  }, [database.type, history, latest]);

  return (
    <div className="space-y-4">
      {canViewMonitoring &&
        (latest ? (
          <div
            className={`grid gap-3 ${database.type === "postgres" ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-4"}`}
          >
            {overviewMetrics.map((metric) => (
              <StatCard
                key={metric.key}
                label={metric.label}
                value={metric.value}
                icon={Activity}
                history={metric.history}
                sparklineMax={metric.sparklineMax}
                progress={metric.progress}
                subtitle={metric.subtitle}
                color={METRIC_COLORS[metric.key] ?? "var(--color-primary)"}
              />
            ))}
          </div>
        ) : (
          <div className="border border-border bg-card p-4 text-sm text-muted-foreground">
            Waiting for monitoring data...
          </div>
        ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Connection Details</h2>
          </div>
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Endpoint"
              value={<span className="font-mono">{database.host}:{database.port}</span>}
            />
            <DetailRow
              label="Target"
              value={<span className="font-mono">{database.databaseName || "-"}</span>}
            />
            <DetailRow label="TLS" value={database.tlsEnabled ? "Enabled" : "Disabled"} />
            <DetailRow
              label="Username"
              value={<span className="font-mono">{database.username || "-"}</span>}
            />
          </div>
        </div>
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Database Information</h2>
          </div>
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Status"
              value={
                <Badge variant={HEALTH_BADGE[healthStatus] ?? "secondary"}>
                  {formatHealthStatusLabel(healthStatus)}
                </Badge>
              }
            />
            <DetailRow
              label="Provider"
              value={<span className="capitalize">{database.type}</span>}
            />
            <DetailRow
              label="Last Check"
              value={
                database.lastHealthCheckAt
                  ? new Date(database.lastHealthCheckAt).toLocaleTimeString()
                  : "Never"
              }
            />
            {database.lastError && (
              <DetailRow
                label="Last Error"
                value={<span className="max-w-[24rem] text-right text-destructive">{database.lastError}</span>}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsoleTab({ database }: { database: DatabaseConnection }) {
  const [input, setInput] = useState(database.type === "postgres" ? "select 1" : "PING");
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const resultScrollRef = useRef<HTMLDivElement>(null);

  const execute = async () => {
    setRunning(true);
    try {
      const data =
        database.type === "postgres"
          ? await api.executePostgresSql(database.id, input)
          : await api.executeRedisCommand(database.id, input);
      setResult(data);
      setResultOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Query failed");
    } finally {
      setRunning(false);
    }
  };

  const tableResult =
    database.type === "postgres" &&
    result &&
    typeof result === "object" &&
    "fields" in result &&
    Array.isArray((result as { fields: string[] }).fields)
      ? (result as { fields: string[]; rows: Record<string, unknown>[] })
      : null;
  const resultRowVirtualizer = useVirtualizer({
    count: tableResult?.rows.length ?? 0,
    getScrollElement: () => resultScrollRef.current,
    estimateSize: () => VIRTUAL_RESULT_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => {
      if (!tableResult) return index;
      return `${index}-${JSON.stringify(tableResult.rows[index] ?? null)}`;
    },
  });
  const resultVirtualRows = tableResult ? resultRowVirtualizer.getVirtualItems() : [];
  const resultTopPadding = resultVirtualRows[0]?.start ?? 0;
  const resultBottomPadding = tableResult
    ? Math.max(
        0,
        resultRowVirtualizer.getTotalSize() - (resultVirtualRows[resultVirtualRows.length - 1]?.end ?? 0)
      )
    : 0;

  useEffect(() => {
    if (!resultOpen || !tableResult) return;
    const frame = requestAnimationFrame(() => {
      resultRowVirtualizer.measure();
      resultRowVirtualizer.scrollToOffset(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultOpen, tableResult, resultRowVirtualizer]);

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3 bg-card border-b border-border shrink-0">
            <div>
              <h3 className="text-sm font-semibold">
                {database.type === "postgres" ? "SQL Console" : "Redis Command Console"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Run a single {database.type === "postgres" ? "SQL statement" : "Redis command"}.
              </p>
            </div>
            <Button size="sm" onClick={() => void execute()} disabled={running}>
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </div>
          <CodeEditor
            value={input}
            onChange={setInput}
            language={database.type === "postgres" ? "sql" : "plain"}
            minHeight="240px"
            className="border-0 flex-1 min-h-0"
          />
        </div>
      </div>

      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="w-[90vw] sm:max-w-[64rem] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {database.type === "postgres" ? "Query Result" : "Command Result"}
            </DialogTitle>
          </DialogHeader>
          {tableResult ? (
            <div ref={resultScrollRef} className="flex-1 min-h-0 overflow-auto border border-border bg-card">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    {tableResult.fields.map((field) => (
                      <th
                        key={field}
                        className="px-4 py-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase whitespace-nowrap"
                      >
                        {field}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultTopPadding > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={tableResult.fields.length} style={{ height: resultTopPadding, padding: 0 }} />
                    </tr>
                  )}
                  {resultVirtualRows.map((virtualRow) => {
                    const row = tableResult.rows[virtualRow.index];
                    return (
                      <tr
                        key={`${virtualRow.index}-${JSON.stringify(row)}`}
                        className="border-b border-border last:border-b-0"
                      >
                        {tableResult.fields.map((field) => (
                          <td
                            key={field}
                            className="px-4 py-3 font-mono whitespace-nowrap align-top"
                          >
                            {stringifyCell(row?.[field])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {resultBottomPadding > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={tableResult.fields.length}
                        style={{ height: resultBottomPadding, padding: 0 }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-border bg-card overflow-hidden flex-1 min-h-0">
              <pre className="overflow-auto p-4 text-sm whitespace-pre-wrap h-full">
                {result ? JSON.stringify(result, null, 2) : "No results yet."}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExplorerTab({ database, canWrite }: { database: DatabaseConnection; canWrite: boolean }) {
  return database.type === "postgres" ? (
    <PostgresExplorer database={database} canWrite={canWrite} />
  ) : (
    <RedisExplorer database={database} canWrite={canWrite} />
  );
}

function PostgresExplorer({
  database,
  canWrite,
}: {
  database: DatabaseConnection;
  canWrite: boolean;
}) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [tables, setTables] = useState<Array<{ name: string; type: "table" | "view" }>>([]);
  const [table, setTable] = useState("");
  const [metadata, setMetadata] = useState<PostgresTableMetadata | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [draftRows, setDraftRows] = useState<Record<string, Record<string, unknown>>>({});
  const [newRows, setNewRows] = useState<Array<Record<string, unknown>>>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const [sortBy, setSortBy] = useState<string>();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const explorerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listPostgresSchemas(database.id).then((data) => {
      setSchemas(data);
      setSchema(data[0] ?? "public");
    });
  }, [database.id]);

  useEffect(() => {
    if (!schema) return;
    api.listPostgresTables(database.id, schema).then((data) => {
      setTables(data);
      setTable((current) => (data.some((item) => item.name === current) ? current : (data[0]?.name ?? "")));
      if (data.length === 0) {
        setMetadata(null);
        setRows([]);
        setDraftRows({});
        setNewRows([]);
      }
    });
  }, [database.id, schema]);

  const loadRows = useCallback(async (page = 1, append = false) => {
    if (!schema || !table) return;
    try {
      const data = await api.browsePostgresRows(database.id, {
        schema,
        table,
        page,
        limit: POSTGRES_EXPLORER_PAGE_SIZE,
        sortBy,
        sortOrder,
      });
      setMetadata(data.metadata);
      setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
      setCurrentPage(data.page);
      setTotalRows(data.total);
      if (!append) {
        setDraftRows({});
        setNewRows([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load rows");
    }
  }, [database.id, schema, sortBy, sortOrder, table]);

  useEffect(() => {
    void loadRows(1, false);
  }, [loadRows]);

  const hasMoreRows = rows.length < totalRows;
  const loadMoreRows = useCallback(async () => {
    if (!hasMoreRows || loadingMoreRows || refreshing || saving) return;
    setLoadingMoreRows(true);
    try {
      await loadRows(currentPage + 1, true);
    } finally {
      setLoadingMoreRows(false);
    }
  }, [currentPage, hasMoreRows, loadRows, loadingMoreRows, refreshing, saving]);

  useEffect(() => {
    const node = explorerScrollRef.current;
    if (!node) return;

    const onScroll = () => {
      if (node.scrollTop + node.clientHeight >= node.scrollHeight - 320) {
        void loadMoreRows();
      }
    };

    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [loadMoreRows]);

  useEffect(() => {
    const node = explorerScrollRef.current;
    if (!node || !hasMoreRows || loadingMoreRows) return;
    if (node.scrollHeight <= node.clientHeight + 1) {
      void loadMoreRows();
    }
  }, [hasMoreRows, loadingMoreRows, loadMoreRows, rows.length]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => explorerScrollRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: 16,
    getItemKey: (index) => {
      if (!metadata) return index;
      return getRowKey(metadata, rows[index] ?? {});
    },
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const gridTemplateColumns = metadata
    ? `repeat(${metadata.columns.length}, minmax(180px, 1fr))`
    : "";

  useEffect(() => {
    if (metadata && sortBy && !metadata.columns.some((column) => column.name === sortBy)) {
      setSortBy(undefined);
      setSortOrder("asc");
    }
  }, [metadata, sortBy]);

  const editedRowCount = useMemo(
    () =>
      rows.reduce((count, row) => {
        const key = getRowKey(metadata!, row);
        return draftRows[key] ? count + 1 : count;
      }, 0),
    [draftRows, metadata, rows]
  );
  const validPendingRows = useMemo(
    () => (metadata ? newRows.filter((row) => isPendingRowValid(row, metadata.columns)) : []),
    [metadata, newRows]
  );
  const pendingRowStates = useMemo(
    () => (metadata ? newRows.map((row) => getPendingRowState(row, metadata.columns)) : []),
    [metadata, newRows]
  );
  const invalidPendingRowCount = pendingRowStates.filter((state) => state === "invalid").length;
  const emptyPendingRowCount = pendingRowStates.filter((state) => state === "empty").length;
  const dirtyCount = editedRowCount + validPendingRows.length;
  const canSaveChanges =
    !saving &&
    dirtyCount > 0 &&
    invalidPendingRowCount === 0 &&
    emptyPendingRowCount === 0;

  const updateDraftRow = (
    row: Record<string, unknown>,
    column: PostgresTableColumn,
    raw: string
  ) => {
    if (!metadata) return;
    const key = getRowKey(metadata, row);
    const base = draftRows[key] ?? row;
    const nextDraft = {
      ...base,
      [column.name]: coerceCellInput(column, raw),
    };
    const matchesOriginal = metadata.columns.every((candidate) =>
      valuesEqual(nextDraft[candidate.name], row[candidate.name])
    );
    setDraftRows((prev) => {
      if (matchesOriginal) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: nextDraft,
      };
    });
  };

  const updateNewRow = (rowIndex: number, column: PostgresTableColumn, raw: string) => {
    setNewRows((prev) =>
      prev.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              [column.name]: coerceCellInput(column, raw),
            }
          : row
      )
    );
  };

  const saveChanges = async () => {
    if (!metadata || !schema || !table) return;
    setSaving(true);
    try {
      for (const row of rows) {
        const key = getRowKey(metadata, row);
        const draft = draftRows[key];
        if (!draft) continue;
        await api.updatePostgresRow(
          database.id,
          schema,
          table,
          buildPrimaryKey(metadata, row),
          draft
        );
      }
      for (const pendingRow of validPendingRows) {
        await api.insertPostgresRow(database.id, schema, table, pendingRow);
      }
      toast.success("Table changes saved");
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save table changes");
    } finally {
      setSaving(false);
    }
  };

  const refreshRows = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadRows(1, false), new Promise((resolve) => setTimeout(resolve, 500))]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSort = (columnName: string) => {
    if (sortBy === columnName) {
      if (sortOrder === "asc") {
        setSortOrder("desc");
        return;
      }
      setSortBy(undefined);
      setSortOrder("asc");
      return;
    }
    setSortBy(columnName);
    setSortOrder("asc");
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="flex flex-wrap items-end gap-3 shrink-0">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Schema</label>
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Table</label>
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Table" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name} ({item.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void refreshRows()} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {metadata ? (
        <div className="border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-full">
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">
                {metadata.schema}.{metadata.table}
              </h3>
              <p className="text-xs text-muted-foreground">
                {metadata.columns.length} columns
                {metadata.hasPrimaryKey
                  ? ` · editable grid`
                  : ` · no primary key, existing rows are browse-only`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setNewRows((prev) => [
                      ...prev,
                      Object.fromEntries(metadata.columns.map((column) => [column.name, null])),
                    ])
                  }
                  title="Insert row"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
              {canWrite && (
                <Button size="sm" onClick={() => void saveChanges()} disabled={!canSaveChanges}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
                </Button>
              )}
            </div>
          </div>

          <div ref={explorerScrollRef} className="overflow-auto flex-1 min-h-0">
            {metadata.columns.length > 0 && (
              <div
                className="grid border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card z-10"
                style={{
                  gridTemplateColumns,
                }}
              >
                {metadata.columns.map((column) => (
                  <div key={column.name} className="border-r border-border last:border-r-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                      onClick={() => toggleSort(column.name)}
                      title={`Sort by ${column.name}`}
                    >
                      <span>{column.name}</span>
                      {column.isPrimaryKey && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          PK
                        </Badge>
                      )}
                      <span className="ml-auto text-muted-foreground/80">
                        {sortBy === column.name ? (
                          sortOrder === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const rowKey = getRowKey(metadata, row);
                const draft = draftRows[rowKey] ?? row;
                const isLastLoadedRow =
                  virtualRow.index === rows.length - 1 && newRows.length === 0 && !loadingMoreRows;
                return (
                  <div
                    key={rowKey}
                    ref={rowVirtualizer.measureElement}
                    className={`absolute inset-x-0 grid ${isLastLoadedRow ? "" : "border-b border-border"}`}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns,
                    }}
                  >
                    {metadata.columns.map((column, columnIndex) => {
                      const isLastColumn = columnIndex === metadata.columns.length - 1;
                      const canInlineDelete = canWrite && metadata.hasPrimaryKey && isLastColumn;

                      if (canWrite && metadata.hasPrimaryKey) {
                        if (canInlineDelete) {
                          return (
                            <div key={column.name} className="flex items-center border-r border-border last:border-r-0">
                              <Input
                                value={stringifyCell(draft[column.name])}
                                onChange={(event) => updateDraftRow(row, column, event.target.value)}
                                className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex-1 min-w-0"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                                onClick={() =>
                                  void api
                                    .deletePostgresRow(
                                      database.id,
                                      schema,
                                      table,
                                      buildPrimaryKey(metadata, row)
                                    )
                                    .then(() => {
                                      toast.success("Row deleted");
                                      return loadRows();
                                    })
                                    .catch((error) => {
                                      toast.error(
                                        error instanceof Error ? error.message : "Failed to delete row"
                                      );
                                    })
                                }
                                title="Delete row"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <div key={column.name} className="border-r border-border last:border-r-0">
                            <Input
                              value={stringifyCell(draft[column.name])}
                              onChange={(event) => updateDraftRow(row, column, event.target.value)}
                              className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                            />
                          </div>
                        );
                      }

                      return (
                        <div key={column.name} className="border-r border-border last:border-r-0">
                          <div className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words min-h-9">
                            {stringifyCell(draft[column.name]) || (
                              <span className="text-muted-foreground">NULL</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div>
              {newRows.map((newRow, rowIndex) => (
                <div
                  key={`new-${rowIndex}`}
                  className={`grid border-border bg-emerald-500/5 ${
                    rowIndex === newRows.length - 1 ? "" : "border-b"
                  }`}
                  style={{
                    gridTemplateColumns,
                  }}
                >
                  {metadata.columns.map((column, columnIndex) => {
                    const isLastColumn = columnIndex === metadata.columns.length - 1;
                    const canInlineRemove = canWrite && isLastColumn;

                    if (canInlineRemove) {
                      return (
                        <div key={column.name} className="flex items-center border-r border-border last:border-r-0">
                          <Input
                            value={stringifyCell(newRow[column.name])}
                            onChange={(event) => updateNewRow(rowIndex, column, event.target.value)}
                            className={`h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex-1 min-w-0 ${
                              pendingRowStates[rowIndex] === "invalid" &&
                              !column.nullable &&
                              !column.hasDefault &&
                              isBlankValue(newRow[column.name])
                                ? "bg-red-500/15 text-red-400"
                                : ""
                            }`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                            onClick={() =>
                              setNewRows((prev) => prev.filter((_, index) => index !== rowIndex))
                            }
                            title="Remove pending row"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    }

                    return (
                      <div key={column.name} className="border-r border-border last:border-r-0">
                        <Input
                          value={stringifyCell(newRow[column.name])}
                          onChange={(event) => updateNewRow(rowIndex, column, event.target.value)}
                          className={`h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                            pendingRowStates[rowIndex] === "invalid" &&
                            !column.nullable &&
                            !column.hasDefault &&
                            isBlankValue(newRow[column.name])
                              ? "bg-red-500/15 text-red-400"
                              : ""
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
              {loadingMoreRows && (
                <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more rows
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          No table selected.
        </div>
      )}
    </div>
  );
}

function RedisExplorer({ database, canWrite }: { database: DatabaseConnection; canWrite: boolean }) {
  const [keys, setKeys] = useState<RedisKeyRecord[]>([]);
  const [selected, setSelected] = useState<{
    key: string;
    type: string;
    ttlSeconds: number;
    value: unknown;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const data = await api.scanRedisKeys(database.id, { limit: 200, search: search || undefined });
      setKeys(data.keys);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Redis keys");
    }
  }, [database.id, search]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const selectKey = async (key: string) => {
    try {
      const data = await api.getRedisKey(database.id, key);
      setSelected(data);
      setCreating(false);
      setEditor(typeof data.value === "string" ? data.value : JSON.stringify(data.value ?? null, null, 2));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load key");
    }
  };

  const startCreate = () => {
    setCreating(true);
    setSelected({ key: "", type: "string", ttlSeconds: -1, value: "" });
    setEditor("");
  };

  const save = async () => {
    if (!selected) return;
    try {
      const value = selected.type === "string" ? editor : JSON.parse(editor || "null");
      const data = await api.setRedisKey(database.id, {
        key: selected.key,
        type: selected.type,
        value,
        ttlSeconds: selected.ttlSeconds >= 0 ? selected.ttlSeconds : undefined,
      });
      setSelected(data);
      setCreating(false);
      await loadKeys();
      toast.success(creating ? "Key created" : "Key saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save Redis key");
    }
  };

  const remove = async () => {
    if (!selected?.key) return;
    try {
      await api.deleteRedisKey(database.id, selected.key);
      setSelected(null);
      setEditor("");
      await loadKeys();
      toast.success("Key deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete Redis key");
    }
  };

  const refreshKeys = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadKeys(), new Promise((resolve) => setTimeout(resolve, 500))]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="grid gap-4 xl:grid-cols-[380px,minmax(0,1fr)] flex-1 min-h-0">
        <div className="border border-border bg-card overflow-hidden min-h-0 max-h-full">
          <div className="flex gap-2 p-3 border-b border-border">
            <Input
              placeholder="Search keys..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void refreshKeys()}
            />
            <Button variant="outline" onClick={() => void refreshKeys()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <DataTable
            columns={[
              { key: "key", header: "Key", render: (row) => row.key, truncate: true },
              { key: "type", header: "Type", render: (row) => row.type, width: "96px" },
              {
                key: "ttl",
                header: "TTL",
                render: (row) => (row.ttlSeconds >= 0 ? `${row.ttlSeconds}s` : "persistent"),
                width: "120px",
              },
            ]}
            data={keys}
            keyFn={(row) => row.key}
            onRowClick={(row) => void selectKey(row.key)}
            emptyMessage="No keys found."
          />
          {canWrite && (
            <div className="border-t border-border px-4 py-3">
              <Button variant="ghost" className="px-0" onClick={startCreate}>
                <Plus className="h-4 w-4" />
                Create key
              </Button>
            </div>
          )}
        </div>

        <div className="border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-full">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="grid gap-3 md:grid-cols-[1.2fr,160px,140px]">
                    <Input
                      value={selected.key}
                      onChange={(e) =>
                        setSelected((prev) => (prev ? { ...prev, key: e.target.value } : prev))
                      }
                      disabled={!canWrite && !creating}
                    />
                    <Select
                      value={selected.type}
                      onValueChange={(value) =>
                        setSelected((prev) => (prev ? { ...prev, type: value } : prev))
                      }
                      disabled={!canWrite}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["string", "hash", "list", "set", "zset"].map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={selected.ttlSeconds >= 0 ? String(selected.ttlSeconds) : ""}
                      onChange={(e) =>
                        setSelected((prev) =>
                          prev
                            ? {
                                ...prev,
                                ttlSeconds:
                                  e.target.value.trim() === "" ? -1 : Number(e.target.value || "-1"),
                              }
                            : prev
                        )
                      }
                      placeholder="TTL seconds"
                      disabled={!canWrite}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave TTL blank for a persistent key.
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => void save()}>
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </Button>
                    {!creating && (
                      <Button variant="destructive" onClick={() => void remove()}>
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <CodeEditor
                value={editor}
                onChange={setEditor}
                language={selected.type === "string" ? "plain" : "json"}
                minHeight="360px"
                readOnly={!canWrite}
                className="border-0 flex-1 min-h-0"
              />
            </>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
              Select a Redis key to inspect it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsTab({
  database,
  onSaved,
}: {
  database: DatabaseConnection;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DatabaseConnectionDraft>(draftFromConnection(database));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftFromConnection(database));
  }, [database]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateDatabase(database.id, buildDatabasePayload(draft));
      toast.success("Database settings updated");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update database");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <DatabaseConnectionForm draft={draft} onChange={setDraft} disableType mode="metadata" />
      <DialogFooter>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </div>
  );
}
