import { useCallback, useEffect, useRef, useState } from "react";
import { VirtualLogList } from "@/components/ui/virtual-log-list";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/stores/auth";

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  component: string;
  fields?: Record<string, string>;
}

function formatMessage(entry: LogEntry): string {
  let msg = entry.message;
  if (entry.fields && Object.keys(entry.fields).length > 0) {
    const parts = Object.entries(entry.fields).map(([k, v]) => `${k}=${v}`);
    msg += ` ${parts.join(" ")}`;
  }
  return msg;
}

const LEVEL_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  debug: "secondary",
  info: "default",
  warn: "warning",
  error: "destructive",
};

interface NodeLogsTabProps {
  nodeId: string;
  nodeStatus: string;
}

export function NodeLogsTab({ nodeId, nodeStatus }: NodeLogsTabProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const connect = useCallback(() => {
    if (nodeStatus !== "online") return;
    if (esRef.current) esRef.current.close();

    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);
    if (levelFilter !== "all") params.set("level", levelFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);

    const es = new EventSource(`/api/nodes/${nodeId}/logs?${params}`);
    esRef.current = es;

    es.addEventListener("connected", () => setLogs([]));
    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 300 ? next.slice(-300) : next;
        });
      } catch {}
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
      }
    };

    return () => es.close();
  }, [nodeId, nodeStatus, levelFilter, debouncedSearch]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      esRef.current?.close();
    };
  }, [connect]);

  if (nodeStatus !== "online") {
    return (
      <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
        <p className="text-muted-foreground">Node is offline — daemon logs unavailable</p>
      </div>
    );
  }

  if (logs.length === 0 && !search && levelFilter === "all") {
    return (
      <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
        <p className="text-muted-foreground">No daemon logs yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Filters */}
      <div className="flex gap-3 shrink-0">
        <div className="flex-1">
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 flex flex-col border border-border bg-card">
        {/* Fixed header */}
        <div className="grid border-b border-border text-left text-xs font-medium text-muted-foreground shrink-0" style={{ gridTemplateColumns: "180px 80px 120px 1fr" }}>
          <div className="p-3">Time</div>
          <div className="p-3">Level</div>
          <div className="p-3">Component</div>
          <div className="p-3">Message</div>
        </div>
        {/* Scrollable body */}
        <VirtualLogList
          lines={logs}
          keyFn={(_, i) => i}
          estimateLineHeight={44}
          renderLine={(line) => {
            const entry = line as LogEntry;
            return (
              <div className="grid border-b border-border" style={{ gridTemplateColumns: "180px 80px 120px 1fr" }}>
                <div className="p-3 text-sm text-muted-foreground whitespace-nowrap">{entry.timestamp}</div>
                <div className="p-3 text-sm">
                  <Badge variant={LEVEL_VARIANT[entry.level] ?? "secondary"} className="text-xs uppercase">
                    {entry.level}
                  </Badge>
                </div>
                <div className="p-3 text-sm text-muted-foreground">{entry.component || "daemon"}</div>
                <div className="p-3 text-sm">{formatMessage(entry)}</div>
              </div>
            );
          }}
          className="flex-1 min-h-0 overflow-y-auto"
          emptyState={
            <div className="text-center py-16 text-sm text-muted-foreground">Waiting for logs...</div>
          }
        />
      </div>
    </div>
  );
}
