import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTransition } from "@/components/common/PageTransition";
import { Button } from "@/components/ui/button";
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

export function AuditLog() {
  const cachedAudit = api.getCached<{
    data: AuditLogEntry[];
    pagination: { totalPages: number; total: number };
  }>("audit:list");
  const [entries, setEntries] = useState<AuditLogEntry[]>(cachedAudit?.data ?? []);
  const [isLoading, setIsLoading] = useState(!cachedAudit);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      if (entries.length === 0) setIsLoading(true);
      try {
        const result = await api.getAuditLog({
          page,
          limit: 25,
          action: actionFilter !== "all" ? actionFilter : undefined,
          resourceType: resourceFilter !== "all" ? resourceFilter : undefined,
        });
        setEntries(result.data || []);
        setTotalPages(result.pagination?.totalPages ?? 1);
        setTotal(result.pagination?.total ?? 0);
      } catch {
        /* ignore */
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [page, actionFilter, resourceFilter, entries.length]);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">{total} entries</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="w-48">
            <Select
              value={actionFilter}
              onValueChange={(v) => {
                setActionFilter(v);
                setPage(1);
              }}
            >
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
            <Select
              value={resourceFilter}
              onValueChange={(v) => {
                setResourceFilter(v);
                setPage(1);
              }}
            >
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

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : entries.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">User</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Action</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Resource</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">IP Address</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="p-3 text-sm">
                        {entry.userName || entry.userEmail || "System"}
                      </td>
                      <td className="p-3 text-sm">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5">
                          {entry.action}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {entry.resourceType}
                        {entry.resourceId ? ` / ${entry.resourceId.slice(0, 8)}...` : ""}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground font-mono text-xs">
                        {entry.ipAddress || "—"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {formatRelativeDate(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No audit log entries found
          </div>
        )}
      </div>
    </PageTransition>
  );
}
