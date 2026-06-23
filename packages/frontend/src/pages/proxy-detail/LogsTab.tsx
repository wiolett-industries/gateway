import { useEffect, useRef, useState } from "react";
import {
  ResourceListCell,
  type ResourceListColumn,
  ResourceListFrame,
  ResourceListHeaderTable,
  ResourceListRow,
  ResourceListTable,
} from "@/components/common/ResourceListLayout";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NginxLogEntry {
  hostId: string;
  timestamp: string;
  remoteAddr: string;
  method: string;
  path: string;
  status: number;
  bodyBytesSent: string;
  raw: string;
  logType: string;
  level: string;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  "2": "success",
  "3": "default",
  "4": "warning",
  "5": "destructive",
};

const LOG_COLUMNS: ResourceListColumn<NginxLogEntry>[] = [
  { id: "time", label: "Time", width: 160 },
  { id: "type", label: "Type", width: 60 },
  { id: "remoteAddr", label: "Remote Addr", width: 120 },
  { id: "method", label: "Method", width: 60 },
  { id: "path", label: "Path / Message" },
  { id: "status", label: "Status", width: 60 },
  { id: "size", label: "Size", width: 70 },
];

export function LogsTab({ hostId }: { hostId: string }) {
  const [logs, setLogs] = useState<NginxLogEntry[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolled.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new logs
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !userScrolled.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/monitoring/logs/${hostId}/stream`, {
      withCredentials: true,
    });
    esRef.current = es;

    setStreamError(null);

    es.addEventListener("connected", () => {
      setStreamError(null);
      setLogs([]);
    });
    es.addEventListener("log-error", (e) => {
      try {
        const data = JSON.parse(e.data) as { message?: string };
        setStreamError(data.message || "Log stream is not available");
      } catch {
        setStreamError("Log stream is not available");
      }
    });
    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as NginxLogEntry;
        // Client-side filtering
        if (statusFilter !== "all") {
          const prefix = statusFilter.replace("xx", "");
          if (entry.logType === "error") {
            if (statusFilter !== "error") return;
          } else if (!String(entry.status).startsWith(prefix)) {
            return;
          }
        }
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          if (
            !entry.path?.toLowerCase().includes(q) &&
            !entry.remoteAddr?.toLowerCase().includes(q) &&
            !entry.raw?.toLowerCase().includes(q)
          ) {
            return;
          }
        }
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 300 ? next.slice(-300) : next;
        });
      } catch {}
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) es.close();
    };

    return () => es.close();
  }, [hostId, statusFilter, debouncedSearch]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
        <Input
          className="flex-1"
          placeholder="Search by path or IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="2xx">2xx Success</SelectItem>
            <SelectItem value="3xx">3xx Redirect</SelectItem>
            <SelectItem value="4xx">4xx Client Err</SelectItem>
            <SelectItem value="5xx">5xx Server Err</SelectItem>
            <SelectItem value="error">Error Log</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ResourceListFrame
        minWidth={920}
        className="min-h-0 flex-1"
        innerClassName="flex h-full flex-col"
      >
        <ResourceListHeaderTable columns={LOG_COLUMNS} />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <ResourceListTable columns={LOG_COLUMNS}>
            {logs.length === 0 ? (
              <ResourceListRow className="opacity-100">
                <ResourceListCell
                  colSpan={7}
                  align="center"
                  contentClassName="justify-center py-16"
                >
                  {streamError ?? "Waiting for log events..."}
                </ResourceListCell>
              </ResourceListRow>
            ) : (
              logs.map((entry, i) => {
                const isError = entry.logType === "error";
                return (
                  <ResourceListRow key={i} className="opacity-100">
                    <ResourceListCell contentClassName="whitespace-nowrap text-sm text-muted-foreground">
                      {entry.timestamp}
                    </ResourceListCell>
                    <ResourceListCell>
                      <Badge variant={isError ? "destructive" : "secondary"}>
                        {isError ? "err" : "acc"}
                      </Badge>
                    </ResourceListCell>
                    <ResourceListCell contentClassName="text-sm text-muted-foreground">
                      {isError ? "\u2014" : entry.remoteAddr}
                    </ResourceListCell>
                    <ResourceListCell contentClassName="text-sm">
                      {isError ? "\u2014" : entry.method}
                    </ResourceListCell>
                    <ResourceListCell
                      contentClassName="truncate text-sm"
                      title={isError ? entry.raw : entry.path}
                    >
                      {isError ? entry.raw : entry.path}
                    </ResourceListCell>
                    <ResourceListCell>
                      {isError ? (
                        <Badge variant="destructive">{entry.level || "err"}</Badge>
                      ) : (
                        <Badge variant={STATUS_VARIANT[String(entry.status)[0]] ?? "secondary"}>
                          {entry.status}
                        </Badge>
                      )}
                    </ResourceListCell>
                    <ResourceListCell contentClassName="text-sm text-muted-foreground">
                      {isError ? "\u2014" : entry.bodyBytesSent}
                    </ResourceListCell>
                  </ResourceListRow>
                );
              })
            )}
          </ResourceListTable>
        </div>
      </ResourceListFrame>
    </div>
  );
}
