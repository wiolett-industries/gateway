import { useEffect, useRef, useState } from "react";
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

export function LogsTab({ hostId }: { hostId: string }) {
  const [logs, setLogs] = useState<NginxLogEntry[]>([]);
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

    es.addEventListener("connected", () => setLogs([]));
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

  const colgroup = (
    <colgroup>
      <col style={{ width: "160px" }} />
      <col style={{ width: "60px" }} />
      <col style={{ width: "120px" }} />
      <col style={{ width: "60px" }} />
      <col />
      <col style={{ width: "60px" }} />
      <col style={{ width: "70px" }} />
    </colgroup>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex gap-3 shrink-0">
        <Input
          className="flex-1"
          placeholder="Search by path or IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
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

      <div className="flex-1 min-h-0 flex flex-col border border-border bg-card">
        <table className="w-full shrink-0" style={{ tableLayout: "fixed" }}>
          {colgroup}
          <thead>
            <tr className="text-left border-b border-border">
              <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Remote Addr</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Method</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Path / Message</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Size</th>
            </tr>
          </thead>
        </table>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            {colgroup}
            <tbody className="divide-y divide-border">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">
                    Waiting for log events...
                  </td>
                </tr>
              ) : (
                logs.map((entry, i) => {
                  const isError = entry.logType === "error";
                  return (
                    <tr key={i}>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {entry.timestamp}
                      </td>
                      <td className="p-3 text-sm">
                        <Badge
                          variant={isError ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {isError ? "err" : "acc"}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {isError ? "\u2014" : entry.remoteAddr}
                      </td>
                      <td className="p-3 text-sm">{isError ? "\u2014" : entry.method}</td>
                      <td className="p-3 text-sm truncate" title={isError ? entry.raw : entry.path}>
                        {isError ? entry.raw : entry.path}
                      </td>
                      <td className="p-3 text-sm">
                        {isError ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {entry.level || "err"}
                          </Badge>
                        ) : (
                          <Badge
                            variant={STATUS_VARIANT[String(entry.status)[0]] ?? "secondary"}
                            className="text-xs"
                          >
                            {entry.status}
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {isError ? "\u2014" : entry.bodyBytesSent}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
