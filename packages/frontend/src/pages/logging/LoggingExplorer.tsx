import { Plus, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import type {
  LoggingEnvironment,
  LoggingFieldDefinition,
  LoggingSearchRequest,
  LoggingSearchResult,
  LoggingSeverity,
} from "@/types";
import { LoggingEventDetailsDialog } from "./LoggingEventDetailsDialog";

const SEVERITIES: LoggingSeverity[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const FIELD_OPERATORS = ["eq", "contains", "gt", "gte", "lt", "lte"] as const;
const TIME_RANGES = [
  { label: "All time", value: "all", ms: null },
  { label: "15 minutes", value: "15m", ms: 15 * 60 * 1000 },
  { label: "1 hour", value: "1h", ms: 60 * 60 * 1000 },
  { label: "6 hours", value: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24 hours", value: "24h", ms: 24 * 60 * 60 * 1000 },
] as const;
const DEFAULT_TIME_RANGE = "all";

type LabelFilter = { id: string; key: string; value: string };
type FieldFilter = { id: string; key: string; op: string; value: string };

export function LoggingExplorer({
  environment,
  storageAvailable,
  refreshKey = 0,
}: {
  environment: LoggingEnvironment;
  storageAvailable: boolean;
  refreshKey?: number;
}) {
  const [timeRange, setTimeRange] = useState(DEFAULT_TIME_RANGE);
  const [severity, setSeverity] = useState<"all" | LoggingSeverity>("all");
  const [message, setMessage] = useState("");
  const [service, setService] = useState("");
  const [source, setSource] = useState("");
  const [traceId, setTraceId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [spanId, setSpanId] = useState("");
  const [labelFilters, setLabelFilters] = useState<LabelFilter[]>([]);
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([]);
  const [rows, setRows] = useState<LoggingSearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<LoggingSearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const labelDefinitions = useMemo(
    () => environment.fieldSchema.filter((field) => field.location === "label"),
    [environment.fieldSchema]
  );
  const fieldDefinitions = useMemo(
    () => environment.fieldSchema.filter((field) => field.location === "field"),
    [environment.fieldSchema]
  );

  const buildQuery = useCallback(
    (cursor?: string | null): LoggingSearchRequest => {
      const selectedRange =
        TIME_RANGES.find((range) => range.value === timeRange) ?? TIME_RANGES[0];
      const to = selectedRange.ms ? new Date() : null;
      const from = to && selectedRange.ms ? new Date(to.getTime() - selectedRange.ms) : null;
      const labels: Record<string, string> = {};
      for (const filter of labelFilters) {
        const key = filter.key.trim();
        const value = filter.value.trim();
        if (key && value) labels[key] = value;
      }
      const fields: NonNullable<LoggingSearchRequest["fields"]> = {};
      for (const filter of fieldFilters) {
        const key = filter.key.trim();
        if (key && filter.value) {
          fields[key] = {
            op: filter.op,
            value: coerceFieldValue(key, filter.value, fieldDefinitions),
          };
        }
      }

      return {
        from: from?.toISOString(),
        to: to?.toISOString(),
        severities: severity === "all" ? undefined : [severity],
        services: service ? [service] : undefined,
        sources: source ? [source] : undefined,
        message: message || undefined,
        traceId: traceId || undefined,
        spanId: spanId || undefined,
        requestId: requestId || undefined,
        labels: Object.keys(labels).length ? labels : undefined,
        fields: Object.keys(fields).length ? fields : undefined,
        limit: 100,
        cursor,
      };
    },
    [
      fieldDefinitions,
      fieldFilters,
      labelFilters,
      message,
      requestId,
      service,
      severity,
      source,
      spanId,
      timeRange,
      traceId,
    ]
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      void refreshKey;
      if (!storageAvailable) return;
      setLoading(true);
      try {
        const result = await api.searchLogs(environment.id, buildQuery(cursor));
        setRows((current) => (cursor ? [...current, ...result.data] : result.data));
        setNextCursor(result.nextCursor);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to search logs");
      } finally {
        setLoading(false);
      }
    },
    [buildQuery, environment.id, refreshKey, storageAvailable]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setTimeRange(DEFAULT_TIME_RANGE);
    setSeverity("all");
    setMessage("");
    setService("");
    setSource("");
    setTraceId("");
    setRequestId("");
    setSpanId("");
    setLabelFilters([]);
    setFieldFilters([]);
  };

  const hasActiveFilters =
    timeRange !== DEFAULT_TIME_RANGE ||
    severity !== "all" ||
    !!message ||
    !!service ||
    !!source ||
    !!traceId ||
    !!requestId ||
    !!spanId ||
    labelFilters.length > 0 ||
    fieldFilters.length > 0;

  const columns: DataTableColumn<LoggingSearchResult>[] = [
    {
      key: "timestamp",
      header: "Timestamp",
      width: "190px",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.timestamp).toLocaleString()}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      width: "96px",
      render: (row) => (
        <Badge
          variant={
            row.severity === "error" || row.severity === "fatal" ? "destructive" : "secondary"
          }
        >
          {row.severity}
        </Badge>
      ),
    },
    {
      key: "service",
      header: "Service",
      width: "150px",
      truncate: true,
      render: (row) => row.service || "-",
    },
    {
      key: "source",
      header: "Source",
      width: "150px",
      truncate: true,
      render: (row) => row.source || "-",
    },
    {
      key: "message",
      header: "Message",
      width: "minmax(360px,1fr)",
      truncate: true,
      render: (row) => row.message,
    },
  ];

  if (!storageAvailable) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        ClickHouse is configured but unavailable. Metadata management remains available.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SearchFilterBar
        placeholder="Search message text..."
        search={message}
        onSearchChange={setMessage}
        onSearchSubmit={() => void load()}
        hasActiveFilters={hasActiveFilters}
        onReset={reset}
        filters={
          <div className="flex w-full flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <FilterSelect label="Time" value={timeRange} onValueChange={setTimeRange}>
                {TIME_RANGES.map((range) => (
                  <SelectItem key={range.value} value={range.value}>
                    {range.label}
                  </SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Severity"
                value={severity}
                onValueChange={(value) => setSeverity(value as typeof severity)}
              >
                <SelectItem value="all">All severities</SelectItem>
                {SEVERITIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </FilterSelect>
              <FilterInput label="Service" value={service} onChange={setService} />
              <FilterInput label="Source" value={source} onChange={setSource} />
              <FilterInput label="Trace ID" value={traceId} onChange={setTraceId} />
              <FilterInput label="Request ID" value={requestId} onChange={setRequestId} />
              <FilterInput label="Span ID" value={spanId} onChange={setSpanId} />
            </div>
            <FilterRows
              title="Label filters"
              definitions={labelDefinitions}
              rows={labelFilters}
              onAdd={() =>
                setLabelFilters((current) => [
                  ...current,
                  { id: crypto.randomUUID(), key: "", value: "" },
                ])
              }
              onRemove={(id) =>
                setLabelFilters((current) => current.filter((row) => row.id !== id))
              }
              onChange={(id, patch) =>
                setLabelFilters((current) =>
                  current.map((row) => (row.id === id ? { ...row, ...patch } : row))
                )
              }
            />
            <FieldFilterRows
              definitions={fieldDefinitions}
              rows={fieldFilters}
              onAdd={() =>
                setFieldFilters((current) => [
                  ...current,
                  { id: crypto.randomUUID(), key: "", op: "eq", value: "" },
                ])
              }
              onRemove={(id) =>
                setFieldFilters((current) => current.filter((row) => row.id !== id))
              }
              onChange={(id, patch) =>
                setFieldFilters((current) =>
                  current.map((row) => (row.id === id ? { ...row, ...patch } : row))
                )
              }
            />
          </div>
        }
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{rows.length} events</p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        keyFn={(row) => row.eventId}
        onRowClick={setSelected}
        emptyMessage={loading ? "Searching logs..." : "No logs found."}
        horizontalScroll
        footer={
          nextCursor ? (
            <div className="border-t border-border p-3">
              <Button variant="outline" onClick={() => void load(nextCursor)} disabled={loading}>
                Load More
              </Button>
            </div>
          ) : null
        }
      />
      <LoggingEventDetailsDialog
        event={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

function FilterRows({
  title,
  definitions,
  rows,
  onAdd,
  onRemove,
  onChange,
}: {
  title: string;
  definitions: LoggingFieldDefinition[];
  rows: LabelFilter[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<LabelFilter>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)_40px]"
        >
          <KeyInput
            value={row.key}
            definitions={definitions}
            onChange={(key) => onChange(row.id, { key })}
          />
          <Input
            value={row.value}
            placeholder="Value"
            onChange={(event) => onChange(row.id, { value: event.target.value })}
          />
          <Button variant="ghost" size="icon" onClick={() => onRemove(row.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function FieldFilterRows({
  definitions,
  rows,
  onAdd,
  onRemove,
  onChange,
}: {
  definitions: LoggingFieldDefinition[];
  rows: FieldFilter[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<FieldFilter>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Field filters</p>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_130px_minmax(220px,2fr)_40px]"
        >
          <KeyInput
            value={row.key}
            definitions={definitions}
            onChange={(key) => onChange(row.id, { key })}
          />
          <Select value={row.op} onValueChange={(op) => onChange(row.id, { op })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={row.value}
            placeholder="Value"
            onChange={(event) => onChange(row.id, { value: event.target.value })}
          />
          <Button variant="ghost" size="icon" onClick={() => onRemove(row.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function KeyInput({
  value,
  definitions,
  onChange,
}: {
  value: string;
  definitions: LoggingFieldDefinition[];
  onChange: (value: string) => void;
}) {
  if (definitions.length === 0) {
    return (
      <Input value={value} placeholder="Key" onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <Select
      value={value || "__custom"}
      onValueChange={(key) => onChange(key === "__custom" ? "" : key)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Key" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__custom">Custom key</SelectItem>
        {definitions.map((definition) => (
          <SelectItem key={definition.key} value={definition.key}>
            {definition.key}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function coerceFieldValue(key: string, value: string, definitions: LoggingFieldDefinition[]) {
  const definition = definitions.find((item) => item.key === key);
  if (definition?.type === "number") return Number(value);
  if (definition?.type === "boolean") return value === "true";
  return value;
}
