import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
const AUDIT_ACTION_OPTIONS = [
  "access_list.create",
  "access_list.delete",
  "access_list.update",
  "api_token.create",
  "api_token.rename",
  "api_token.revoke",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.settings_update",
  "auth.user_claimed",
  "auth.user_profile_sync",
  "auth.user_provisioned",
  "ca.create",
  "ca.delete",
  "ca.export_key",
  "ca.revoke",
  "ca.update",
  "cert.export_key",
  "cert.issue",
  "cert.revoke",
  "created",
  "database.connection.create",
  "database.connection.delete",
  "database.connection.test",
  "database.connection.update",
  "database.postgres.query",
  "database.postgres.row.delete",
  "database.postgres.row.insert",
  "database.postgres.row.update",
  "database.redis.command.execute",
  "database.redis.key.delete",
  "database.redis.key.expire",
  "database.redis.key.set",
  "docker.container.create",
  "docker.container.duplicate",
  "docker.container.env.update",
  "docker.container.kill",
  "docker.container.live_update",
  "docker.container.recreate",
  "docker.container.remove",
  "docker.container.rename",
  "docker.container.restart",
  "docker.container.start",
  "docker.container.stop",
  "docker.container.update",
  "docker_container.move_to_folder",
  "docker_container.reorder_in_folder",
  "docker.file.write",
  "docker_folder.create",
  "docker_folder.delete",
  "docker_folder.update",
  "docker.image.prune",
  "docker.image.pull",
  "docker.image.remove",
  "docker.network.connect",
  "docker.network.create",
  "docker.network.disconnect",
  "docker.network.remove",
  "docker.registry.create",
  "docker.registry.delete",
  "docker.registry.update",
  "docker.secret.create",
  "docker.secret.delete",
  "docker.secret.update",
  "docker.volume.create",
  "docker.volume.remove",
  "docker.webhook.created",
  "docker.webhook.deleted",
  "docker.webhook.regenerated",
  "docker.webhook.triggered",
  "domain.create",
  "domain.delete",
  "domain.update",
  "expired",
  "group.create",
  "group.delete",
  "group.update",
  "nginx_template.clone",
  "nginx_template.create",
  "nginx_template.delete",
  "nginx_template.update",
  "node.cert_deploy",
  "node.config_push",
  "node.connected",
  "node.create",
  "node.disconnected",
  "node.enroll",
  "node.remove",
  "node.update",
  "notification_rule_created",
  "notification_rule_deleted",
  "notification_rule_updated",
  "notification_webhook_created",
  "notification_webhook_deleted",
  "notification_webhook_updated",
  "proxy_host.create",
  "proxy_host.delete",
  "proxy_host.move_to_folder",
  "proxy_host.update",
  "proxy_host_folder.create",
  "proxy_host_folder.delete",
  "proxy_host_folder.move",
  "proxy_host_folder.update",
  "pulled",
  "renewal_failed",
  "ssl.acme_dns01_start",
  "ssl.acme_dns01_verify",
  "ssl.acme_request",
  "ssl.delete",
  "ssl.link_internal",
  "ssl.renew",
  "ssl.upload",
  "transitioning",
  "updated",
  "user.create",
  "user.delete",
  "user.group_change",
] as const;
const AUDIT_RESOURCE_OPTIONS = [
  "access_list",
  "api-token",
  "ca",
  "certificate",
  "certificate_authority",
  "database",
  "docker-container",
  "docker-image",
  "docker-network",
  "docker-registry",
  "docker-secret",
  "docker-volume",
  "docker-webhook",
  "docker_folder",
  "domain",
  "http-route",
  "nginx_template",
  "node",
  "notification_alert_rule",
  "notification_webhook",
  "permission_group",
  "proxy_host",
  "proxy_host_folder",
  "session",
  "settings",
  "ssl_certificate",
  "user",
] as const;

function formatAuditToken(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

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

export function AuditLog({ embedded = false }: { embedded?: boolean }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
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

  const actionOptions = useMemo(
    () => Array.from(new Set([...AUDIT_ACTION_OPTIONS, ...entries.map((entry) => entry.action)])).sort(),
    [entries]
  );
  const resourceOptions = useMemo(
    () =>
      Array.from(
        new Set([...AUDIT_RESOURCE_OPTIONS, ...entries.map((entry) => entry.resourceType)])
      ).sort(),
    [entries]
  );

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

  const content = (
    <>
      <div className={embedded ? "h-full space-y-4 flex flex-col min-h-0" : "h-full p-6 space-y-4 flex flex-col min-h-0"}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-sm text-muted-foreground">{total} entries</p>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3">
          <div className="w-48">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionOptions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {formatAuditToken(action)}
                  </SelectItem>
                ))}
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
                {resourceOptions.map((resourceType) => (
                  <SelectItem key={resourceType} value={resourceType}>
                    {formatAuditToken(resourceType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && entries.length === 0 ? (
          <LoadingSpinner />
        ) : (
          <div className="flex-1 min-h-0">
            <DataTable
              columns={columns}
              data={entries}
              keyFn={(e) => e.id}
              onRowClick={setSelectedEntry}
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

      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Entry Details</DialogTitle>
          </DialogHeader>
          {selectedEntry ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Action</p>
                  <p className="font-mono text-sm">{selectedEntry.action}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Time</p>
                  <p className="text-sm">{new Date(selectedEntry.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Resource Type</p>
                  <p className="font-mono text-sm">{selectedEntry.resourceType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Resource ID</p>
                  <p className="font-mono text-sm break-all">{selectedEntry.resourceId || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User</p>
                  <p className="text-sm">
                    {selectedEntry.userName || selectedEntry.userEmail || "System"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User ID</p>
                  <p className="font-mono text-sm break-all">{selectedEntry.userId || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IP Address</p>
                  <p className="font-mono text-sm">{selectedEntry.ipAddress || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User Agent</p>
                  <p className="text-sm break-all">{selectedEntry.userAgent || "—"}</p>
                </div>
              </div>
              <div className="border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-medium">Details</h3>
                </div>
                <pre className="overflow-x-auto p-4 text-xs whitespace-pre-wrap">
                  {JSON.stringify(selectedEntry.details ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );

  return embedded ? content : <PageTransition>{content}</PageTransition>;
}
