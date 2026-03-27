import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { AuditLogEntry } from "@/types";
import { formatDateTime } from "@/lib/utils";

const actionColors: Record<string, string> = {
  "ca.create": "bg-[color:var(--color-success)] text-white",
  "ca.revoke": "bg-destructive text-destructive-foreground",
  "cert.issue": "bg-[color:var(--color-success)] text-white",
  "cert.revoke": "bg-destructive text-destructive-foreground",
  "cert.renew": "bg-[color:var(--color-warning)] text-white",
  "user.login": "bg-secondary text-secondary-foreground",
  "user.logout": "bg-secondary text-secondary-foreground",
};

export function AuditLog() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");

  useEffect(() => {
    if (!hasRole("admin")) {
      navigate("/");
      return;
    }
  }, [hasRole, navigate]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await api.getAuditLog({
          page,
          limit: 50,
          action: actionFilter !== "all" ? actionFilter : undefined,
          resourceType: resourceTypeFilter !== "all" ? resourceTypeFilter : undefined,
        });
        setEntries(response.data || []);
        setTotalPages(response.pagination?.totalPages ?? 1);
        setTotal(response.pagination?.total ?? 0);
      } catch (err) {
        console.error("Failed to load audit logs:", err);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [page, actionFilter, resourceTypeFilter]);

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground">{total} entries total</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="ca.create">CA Create</SelectItem>
            <SelectItem value="ca.revoke">CA Revoke</SelectItem>
            <SelectItem value="cert.issue">Cert Issue</SelectItem>
            <SelectItem value="cert.revoke">Cert Revoke</SelectItem>
            <SelectItem value="cert.renew">Cert Renew</SelectItem>
            <SelectItem value="cert.download">Cert Download</SelectItem>
            <SelectItem value="template.create">Template Create</SelectItem>
            <SelectItem value="template.update">Template Update</SelectItem>
            <SelectItem value="template.delete">Template Delete</SelectItem>
            <SelectItem value="user.login">User Login</SelectItem>
            <SelectItem value="user.logout">User Logout</SelectItem>
            <SelectItem value="token.create">Token Create</SelectItem>
            <SelectItem value="token.revoke">Token Revoke</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resourceTypeFilter} onValueChange={(v) => { setResourceTypeFilter(v); setPage(1); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All resources</SelectItem>
            <SelectItem value="ca">Certificate Authority</SelectItem>
            <SelectItem value="certificate">Certificate</SelectItem>
            <SelectItem value="template">Template</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="token">API Token</SelectItem>
          </SelectContent>
        </Select>
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
                  <th className="p-3 text-xs font-medium text-muted-foreground">Timestamp</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Resource</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-accent transition-colors">
                    <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="p-3">
                      <Badge className={actionColors[entry.action] || "bg-secondary text-secondary-foreground"}>
                        {entry.action}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div>
                        <p className="text-sm">{entry.resourceId || "-"}</p>
                        <p className="text-xs text-muted-foreground capitalize">{entry.resourceType}</p>
                      </div>
                    </td>
                    <td className="p-3 text-sm font-mono text-muted-foreground">
                      {entry.ipAddress || "-"}
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
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <ScrollText className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No audit log entries found</p>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
