import { Activity } from "lucide-react";
import { useMemo } from "react";
import { DetailRow } from "@/components/common/DetailRow";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import type { DatabaseConnection, DatabaseMetricSnapshot } from "@/types";
import { formatHealthStatusLabel, formatMetricValue, HEALTH_BADGE, METRIC_COLORS } from "./shared";

interface DatabaseOverviewTabProps {
  database: DatabaseConnection;
  canViewMonitoring: boolean;
  healthStatus: DatabaseConnection["healthStatus"];
  history: DatabaseMetricSnapshot[];
}

export function DatabaseOverviewTab({
  database,
  canViewMonitoring,
  healthStatus,
  history,
}: DatabaseOverviewTabProps) {
  const latest = history.at(-1);
  const showMonitoring = canViewMonitoring && healthStatus !== "offline";
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
        },
        {
          key: "total_connections",
          label: "Connections",
          value: total == null ? "-" : max && max > 0 ? `${total} / ${max}` : `${total}`,
          history: history.map((item) => item.metrics.total_connections_pct ?? 0),
          progress: pct == null ? undefined : { percent: pct },
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
                ? `${formatMetricValue("database_size_bytes", databaseSizeBytes)} / ${formatMetricValue("database_size_bytes", sizeLimitBytes)}`
                : formatMetricValue("database_size_bytes", databaseSizeBytes),
          history: history.map((item) => item.metrics.database_size_bytes ?? 0),
          progress: databaseSizePct == null ? undefined : { percent: databaseSizePct },
          subtitle: databaseSizePct == null ? undefined : `${databaseSizePct.toFixed(1)}% used`,
        },
        {
          key: "lock_count",
          label: "Lock Count",
          value: formatMetricValue("lock_count", lockCount),
          history: history.map((item) => item.metrics.lock_count ?? 0),
        },
        {
          key: "long_running_queries",
          label: "Long-Running Queries",
          value: formatMetricValue("long_running_queries", longRunning),
          history: history.map((item) => item.metrics.long_running_queries ?? 0),
        },
        {
          key: "transaction_rate",
          label: "Transaction Rate",
          value: formatMetricValue("transaction_rate", transactionRate),
          history: history.map((item) => item.metrics.transaction_rate ?? 0),
        },
        {
          key: "cache_hit_ratio",
          label: "Cache Hit Ratio",
          value: formatMetricValue("cache_hit_ratio", cacheHitRatio),
          history: history.map((item) => item.metrics.cache_hit_ratio ?? 0),
          progress: cacheHitRatio == null ? undefined : { percent: cacheHitRatio },
          sparklineMax: 100,
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
      },
      {
        key: "used_memory_bytes",
        label: "Memory",
        value:
          usedMemory == null
            ? "-"
            : maxMemory && maxMemory > 0
              ? `${formatMetricValue("used_memory_bytes", usedMemory)} / ${formatMetricValue("maxmemory_bytes", maxMemory)}`
              : formatMetricValue("used_memory_bytes", usedMemory),
        history: history.map((item) => item.metrics.memory_pct ?? 0),
        progress: memoryPct == null ? undefined : { percent: memoryPct },
        sparklineMax: 100,
        subtitle: memoryPct == null ? undefined : `${memoryPct.toFixed(1)}% used`,
      },
      {
        key: "connected_clients",
        label: "Connected Clients",
        value: formatMetricValue("connected_clients", latest.metrics.connected_clients ?? null),
        history: history.map((item) => item.metrics.connected_clients ?? 0),
      },
      {
        key: "instantaneous_ops_per_sec",
        label: "Ops / Sec",
        value: formatMetricValue(
          "instantaneous_ops_per_sec",
          latest.metrics.instantaneous_ops_per_sec ?? null
        ),
        history: history.map((item) => item.metrics.instantaneous_ops_per_sec ?? 0),
      },
    ];
  }, [database, history, latest]);

  return (
    <div className="space-y-4">
      {showMonitoring &&
        (latest ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              value={
                <span className="block break-all font-mono">
                  {database.host}:{database.port}
                </span>
              }
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
                value={
                  <span className="max-w-[24rem] text-right text-destructive">
                    {database.lastError}
                  </span>
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
