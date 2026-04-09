import { useCallback, useEffect, useRef, useState } from "react";
import { PageTransition } from "@/components/common/PageTransition";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import type { AuditLogEntry } from "@/types";

const PAGE_SIZE = 200;

const columns: DataTableColumn<AuditLogEntry>[] = [
  {
    key: "user",
    header: "User",
    width: "200px",
    truncate: true,
    render: (entry) => entry.userName || entry.userEmail || "System",
  },
  {
    key: "action",
    header: "Action",
    width: "240px",
    render: (entry) => (
      <span className="font-mono text-xs bg-muted px-1.5 py-0.5">{entry.action}</span>
    ),
  },
  {
    key: "resource",
    header: "Resource",
    truncate: true,
    render: (entry) => (
      <span className="text-muted-foreground">
        {entry.resourceType}
        {entry.resourceId ? ` / ${entry.resourceId.slice(0, 8)}…` : ""}
      </span>
    ),
  },
  {
    key: "ip",
    header: "IP Address",
    width: "140px",
    render: (entry) => (
      <span className="font-mono text-xs text-muted-foreground">{entry.ipAddress || "—"}</span>
    ),
  },
  {
    key: "time",
    header: "Time",
    width: "180px",
    render: (entry) => (
      <span className="text-muted-foreground">{formatRelativeDate(entry.createdAt)}</span>
    ),
  },
];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");

  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (resetTo: AuditLogEntry[] | null) => {
      const nextPage = resetTo ? 1 : pageRef.current + 1;
      const requestId = ++requestIdRef.current;
      if (resetTo) {
        setIsLoading(true);
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const result = await api.getAuditLog({
          page: nextPage,
          limit: PAGE_SIZE,
          action: actionFilter !== "all" ? actionFilter : undefined,
          resourceType: resourceFilter !== "all" ? resourceFilter : undefined,
        });
        if (requestId !== requestIdRef.current) return; // stale (filters changed mid-flight)
        const fetched: AuditLogEntry[] = result.data || [];
        const totalPages = result.pagination?.totalPages ?? 1;
        setTotal(result.pagination?.total ?? 0);
        pageRef.current = nextPage;
        setEntries((prev) => (resetTo ? fetched : [...prev, ...fetched]));
        setHasMore(nextPage < totalPages);
      } catch {
        /* ignore */
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [actionFilter, resourceFilter]
  );

  // Initial load + reset on filter change
  useEffect(() => {
    pageRef.current = 0;
    fetchPage([]);
  }, [fetchPage]);

  // Infinite scroll sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !isLoading) {
          fetchPage(null);
        }
      },
      { root, rootMargin: "400px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [fetchPage, hasMore, loadingMore, isLoading]);

  return (
    <PageTransition>
      <div className="h-full p-6 space-y-4 flex flex-col min-h-0">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">{total} entries</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="w-48">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="ca.create">CA created</SelectItem>
                <SelectItem value="ca.revoke">CA revoked</SelectItem>
                <SelectItem value="cert.issue">Cert issued</SelectItem>
                <SelectItem value="cert.revoke">Cert revoked</SelectItem>
                <SelectItem value="ca.export_key">Key exported</SelectItem>
                <SelectItem value="user.group_change">Group changed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select value={resourceFilter} onValueChange={setResourceFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                <SelectItem value="ca">Certificate Authority</SelectItem>
                <SelectItem value="certificate">Certificate</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="template">Template</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <DataTable
              columns={columns}
              data={entries}
              keyFn={(e) => e.id}
              scrollRef={scrollRef}
              emptyMessage="No audit log entries found"
              footer={
                <div ref={sentinelRef} className="py-4 text-center text-xs text-muted-foreground">
                  {loadingMore
                    ? "Loading more…"
                    : !hasMore && entries.length > 0
                      ? "End of log"
                      : ""}
                </div>
              }
            />
          </div>
        )}
      </div>
    </PageTransition>
  );
}
