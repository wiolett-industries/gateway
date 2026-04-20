import { formatBytes } from "@/lib/utils";
import type { DatabaseConnection, PostgresTableColumn, PostgresTableMetadata } from "@/types";

export const HEALTH_BADGE: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  online: "success",
  degraded: "warning",
  offline: "destructive",
  unknown: "secondary",
};

export const METRIC_COLORS: Record<string, string> = {
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

export const POSTGRES_EXPLORER_PAGE_SIZE = 100;
export const VIRTUAL_ROW_HEIGHT = 37;
export const VIRTUAL_RESULT_ROW_HEIGHT = 49;

export function formatMetricValue(key: string, value: number | null): string {
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

export function formatHealthStatusLabel(
  status: DatabaseConnection["healthStatus"] | "unknown"
): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function isNumericColumn(column: PostgresTableColumn): boolean {
  return (
    column.dataType.includes("integer") ||
    column.dataType.includes("numeric") ||
    column.dataType.includes("double") ||
    column.dataType.includes("real") ||
    column.dataType.includes("decimal")
  );
}

export function isBooleanColumn(column: PostgresTableColumn): boolean {
  return column.dataType === "boolean";
}

export function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function isBlankValue(value: unknown): boolean {
  return value == null || value === "";
}

export function isPendingRowValid(
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

export function getPendingRowState(
  row: Record<string, unknown>,
  columns: PostgresTableColumn[]
): "empty" | "valid" | "invalid" {
  const hasAnyValue = columns.some((column) => !isBlankValue(row[column.name]));
  if (!hasAnyValue) return "empty";
  return isPendingRowValid(row, columns) ? "valid" : "invalid";
}

export function coerceCellInput(column: PostgresTableColumn, raw: string): unknown {
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

export function getRowKey(metadata: PostgresTableMetadata, row: Record<string, unknown>): string {
  if (metadata.primaryKey.length > 0) {
    return metadata.primaryKey.map((key) => String(row[key] ?? "")).join(":");
  }
  return JSON.stringify(row);
}

export function buildPrimaryKey(metadata: PostgresTableMetadata, row: Record<string, unknown>) {
  return Object.fromEntries(metadata.primaryKey.map((key) => [key, row[key]]));
}
