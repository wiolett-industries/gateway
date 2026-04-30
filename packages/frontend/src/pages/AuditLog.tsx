import { Download, EllipsisVertical, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

const PAGE_SIZE = 100;
const AUDIT_VIEW_STORAGE_KEY = "gateway:audit-log:view";
const SYSTEM_USER_FILTER = "system";

type AuditExportFormat = "csv" | "tsv" | "txt" | "html";

interface AuditViewConfig {
  excludedActions: string[];
  excludedResourceTypes: string[];
}

interface AuditUserOption {
  id: string;
  label: string;
}

const DEFAULT_AUDIT_VIEW_CONFIG: AuditViewConfig = {
  excludedActions: [],
  excludedResourceTypes: [],
};
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
  "docker.deployment.create",
  "docker.deployment.delete",
  "docker.deployment.deploy",
  "docker.deployment.kill",
  "docker.deployment.restart",
  "docker.deployment.rollback",
  "docker.deployment.slot.stop",
  "docker.deployment.start",
  "docker.deployment.stop",
  "docker.deployment.switch",
  "docker.deployment.update",
  "docker_container.move_to_folder",
  "docker_container.reorder_in_folder",
  "docker.file.write",
  "docker_folder.create",
  "docker_folder.delete",
  "docker_folder.update",
  "docker.health_check.configure",
  "docker.health_check.test",
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
  "docker-deployment",
  "docker-image",
  "docker-health-check",
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
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function readAuditViewConfig(): AuditViewConfig {
  if (typeof window === "undefined") return DEFAULT_AUDIT_VIEW_CONFIG;
  try {
    const raw = window.localStorage.getItem(AUDIT_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIT_VIEW_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AuditViewConfig>;
    return {
      excludedActions: Array.isArray(parsed.excludedActions) ? parsed.excludedActions : [],
      excludedResourceTypes: Array.isArray(parsed.excludedResourceTypes)
        ? parsed.excludedResourceTypes
        : [],
    };
  } catch {
    return DEFAULT_AUDIT_VIEW_CONFIG;
  }
}

function writeAuditViewConfig(config: AuditViewConfig) {
  window.localStorage.setItem(AUDIT_VIEW_STORAGE_KEY, JSON.stringify(config));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : uniqueSorted([...values, value]);
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getAuditEntryUserKey(entry: AuditLogEntry): string {
  return entry.userId ?? SYSTEM_USER_FILTER;
}

function getAuditEntryUserLabel(entry: AuditLogEntry): string {
  return entry.userName || entry.userEmail || (entry.userId ? entry.userId : "System");
}

function buildAuditExportFilename(format: AuditExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `gateway-audit-log-${timestamp}.${format}`;
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function auditEntryToExportRow(entry: AuditLogEntry): string[] {
  return [
    new Date(entry.createdAt).toLocaleString(),
    getAuditEntryUserLabel(entry),
    entry.userId ?? "",
    entry.action,
    entry.resourceType,
    entry.resourceId ?? "",
    entry.ipAddress ?? "",
    entry.userAgent ?? "",
    JSON.stringify(entry.details ?? {}),
  ];
}

const AUDIT_EXPORT_HEADERS = [
  "Time",
  "User",
  "User ID",
  "Action",
  "Resource Type",
  "Resource ID",
  "IP Address",
  "User Agent",
  "Details",
];

function escapeDelimitedValue(value: string, delimiter: "," | "\t"): string {
  if (delimiter === "\t") return value.replace(/[\t\r\n]+/g, " ");
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDelimitedAuditExport(entries: AuditLogEntry[], delimiter: "," | "\t"): string {
  const rows = [AUDIT_EXPORT_HEADERS, ...entries.map(auditEntryToExportRow)];
  return rows
    .map((row) => row.map((value) => escapeDelimitedValue(value, delimiter)).join(delimiter))
    .join("\n");
}

function formatTextAuditExport(entries: AuditLogEntry[]): string {
  return entries
    .map((entry) => {
      const row = auditEntryToExportRow(entry);
      return AUDIT_EXPORT_HEADERS.map((header, index) => `${header}: ${row[index]}`).join("\n");
    })
    .join("\n\n---\n\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatHtmlAuditExport(entries: AuditLogEntry[]): string {
  const head = AUDIT_EXPORT_HEADERS.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = entries
    .map(
      (entry) =>
        `<tr>${auditEntryToExportRow(entry)
          .map((value) => `<td>${escapeHtml(value)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gateway Audit Log</title><style>body{font-family:system-ui,sans-serif;background:#111;color:#eee}table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:6px;text-align:left;vertical-align:top}th{background:#222}</style></head><body><h1>Gateway Audit Log</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function formatAuditExport(
  entries: AuditLogEntry[],
  format: AuditExportFormat
): { content: string; type: string } {
  if (format === "csv") {
    return { content: formatDelimitedAuditExport(entries, ","), type: "text/csv;charset=utf-8" };
  }
  if (format === "tsv") {
    return {
      content: formatDelimitedAuditExport(entries, "\t"),
      type: "text/tab-separated-values;charset=utf-8",
    };
  }
  if (format === "html") {
    return { content: formatHtmlAuditExport(entries), type: "text/html;charset=utf-8" };
  }
  return { content: formatTextAuditExport(entries), type: "text/plain;charset=utf-8" };
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

export function AuditLog({
  embedded = false,
  headerActionsTarget,
}: {
  embedded?: boolean;
  headerActionsTarget?: HTMLElement | null;
}) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [knownUsers, setKnownUsers] = useState<AuditUserOption[]>([]);
  const [viewConfig, setViewConfig] = useState<AuditViewConfig>(() => readAuditViewConfig());
  const [draftViewConfig, setDraftViewConfig] = useState<AuditViewConfig>(viewConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<AuditExportFormat>("csv");
  const [exportActions, setExportActions] = useState<string[]>([]);
  const [exportResourceTypes, setExportResourceTypes] = useState<string[]>([]);
  const [exportUserIds, setExportUserIds] = useState<string[]>([]);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const actionOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...AUDIT_ACTION_OPTIONS,
          ...viewConfig.excludedActions,
          ...entries.map((entry) => entry.action),
        ])
      ).sort(),
    [entries, viewConfig.excludedActions]
  );
  const resourceOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...AUDIT_RESOURCE_OPTIONS,
          ...viewConfig.excludedResourceTypes,
          ...entries.map((entry) => entry.resourceType),
        ])
      ).sort(),
    [entries, viewConfig.excludedResourceTypes]
  );
  const userOptions = useMemo(
    () => [...knownUsers].sort((a, b) => a.label.localeCompare(b.label)),
    [knownUsers]
  );
  const hiddenFilterCount =
    viewConfig.excludedActions.length + viewConfig.excludedResourceTypes.length;

  const rememberUsers = useCallback((items: AuditLogEntry[]) => {
    setKnownUsers((prev) => {
      const next = new Map(prev.map((user) => [user.id, user]));
      for (const entry of items) {
        const id = getAuditEntryUserKey(entry);
        next.set(id, { id, label: getAuditEntryUserLabel(entry) });
      }
      return [...next.values()];
    });
  }, []);

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
          userId: userFilter !== "all" ? userFilter : undefined,
          excludedActions: viewConfig.excludedActions,
          excludedResourceTypes: viewConfig.excludedResourceTypes,
        });
        if (requestId !== requestIdRef.current) return; // stale (filters changed mid-flight)
        const fetched: AuditLogEntry[] = result.data || [];
        rememberUsers(fetched);
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
    [actionFilter, resourceFilter, userFilter, viewConfig, rememberUsers]
  );

  const openConfigureDialog = () => {
    setDraftViewConfig(viewConfig);
    setConfigOpen(true);
  };

  const saveViewConfig = () => {
    const next = {
      excludedActions: uniqueSorted(draftViewConfig.excludedActions),
      excludedResourceTypes: uniqueSorted(draftViewConfig.excludedResourceTypes),
    };
    writeAuditViewConfig(next);
    setViewConfig(next);
    setConfigOpen(false);
  };

  const resetViewConfig = () => {
    setDraftViewConfig(DEFAULT_AUDIT_VIEW_CONFIG);
  };

  const openExportDialog = (format: AuditExportFormat) => {
    setExportFormat(format);
    setExportActions(actionFilter !== "all" ? [actionFilter] : []);
    setExportResourceTypes(resourceFilter !== "all" ? [resourceFilter] : []);
    setExportUserIds(userFilter !== "all" ? [userFilter] : []);
    setExportFrom("");
    setExportTo("");
    setExportOpen(true);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const exportedEntries: AuditLogEntry[] = [];
      let page = 1;
      while (true) {
        const result = await api.getAuditLog({
          page,
          limit: PAGE_SIZE,
          actions: exportActions,
          resourceTypes: exportResourceTypes,
          userIds: exportUserIds,
          from: localDateTimeToIso(exportFrom),
          to: localDateTimeToIso(exportTo),
          excludedActions: viewConfig.excludedActions,
          excludedResourceTypes: viewConfig.excludedResourceTypes,
        });
        exportedEntries.push(...(result.data ?? []));
        const totalPages = result.pagination?.totalPages ?? 1;
        if (page >= totalPages) break;
        page += 1;
      }
      const { content, type } = formatAuditExport(exportedEntries, exportFormat);
      downloadTextFile(content, buildAuditExportFilename(exportFormat), type);
      setExportOpen(false);
      toast.success(`Exported ${exportedEntries.length} audit log entries`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export audit log");
    } finally {
      setExporting(false);
    }
  };

  // Initial load + reset on filter change
  useEffect(() => {
    pageRef.current = 0;
    fetchPage([]);
  }, [fetchPage]);

  useEffect(() => {
    api
      .getAuditUsers()
      .then((users) => {
        setKnownUsers(
          users.map((user) => ({
            id: user.userId ?? SYSTEM_USER_FILTER,
            label: user.userName || user.userEmail || (user.userId ? user.userId : "System"),
          }))
        );
      })
      .catch(() => {});
  }, []);

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

  const auditActions = (
    <ResponsiveHeaderActions
      actions={[
        {
          label: "Configure",
          icon: <Settings className="h-4 w-4" />,
          onClick: openConfigureDialog,
        },
        {
          label: "Download CSV",
          icon: <Download className="h-4 w-4" />,
          onClick: () => openExportDialog("csv"),
          separatorBefore: true,
        },
        {
          label: "Download TSV",
          icon: <Download className="h-4 w-4" />,
          onClick: () => openExportDialog("tsv"),
        },
        {
          label: "Download TXT",
          icon: <Download className="h-4 w-4" />,
          onClick: () => openExportDialog("txt"),
        },
        {
          label: "Download HTML",
          icon: <Download className="h-4 w-4" />,
          onClick: () => openExportDialog("html"),
        },
      ]}
    >
      <Button variant="outline" onClick={openConfigureDialog}>
        <Settings className="h-4 w-4" />
        Configure
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Audit log actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Download</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openExportDialog("csv")}>
            <Download className="h-4 w-4" />
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExportDialog("tsv")}>
            <Download className="h-4 w-4" />
            TSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExportDialog("txt")}>
            <Download className="h-4 w-4" />
            TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExportDialog("html")}>
            <Download className="h-4 w-4" />
            HTML
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ResponsiveHeaderActions>
  );

  const headerActionsPortal =
    embedded && headerActionsTarget ? createPortal(auditActions, headerActionsTarget) : null;

  const content = (
    <>
      {headerActionsPortal}
      <div
        className={
          embedded
            ? "h-full space-y-4 flex flex-col min-h-0"
            : "h-full p-6 space-y-4 flex flex-col min-h-0"
        }
      >
        {!embedded && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Audit Log</h1>
              <p className="text-sm text-muted-foreground">
                {total} entries
                {hiddenFilterCount ? ` · ${hiddenFilterCount} hidden by local view` : ""}
              </p>
            </div>
            {auditActions}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
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
          <div className="w-56">
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {userOptions.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.label}
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
              horizontalScroll
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

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:grid-rows-[auto,minmax(0,1fr),auto] sm:max-h-[calc(100vh-6rem)] sm:overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Configure Audit View</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-1 sm:min-h-0 sm:overflow-y-auto md:grid md:gap-4 md:space-y-0 md:grid-cols-2">
            <AuditOptionChecklist
              title="Hidden Actions"
              description="Checked actions are excluded by the backend before pagination."
              options={actionOptions.map((action) => ({ value: action, label: action }))}
              selected={draftViewConfig.excludedActions}
              onToggle={(value) =>
                setDraftViewConfig((draft) => ({
                  ...draft,
                  excludedActions: toggleValue(draft.excludedActions, value),
                }))
              }
            />
            <AuditOptionChecklist
              title="Hidden Resources"
              description="Checked resources are excluded by the backend before pagination."
              options={resourceOptions.map((resourceType) => ({
                value: resourceType,
                label: resourceType,
              }))}
              selected={draftViewConfig.excludedResourceTypes}
              onToggle={(value) =>
                setDraftViewConfig((draft) => ({
                  ...draft,
                  excludedResourceTypes: toggleValue(draft.excludedResourceTypes, value),
                }))
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetViewConfig}>
              Reset
            </Button>
            <Button onClick={saveViewConfig}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:grid-rows-[auto,minmax(0,1fr),auto] sm:max-h-[calc(100vh-6rem)] sm:overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Download Audit Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-1 sm:min-h-0 sm:overflow-y-auto">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">From</label>
                <Input
                  type="datetime-local"
                  value={exportFrom}
                  onChange={(event) => setExportFrom(event.target.value)}
                  className="audit-date-input mt-1 [&::-webkit-calendar-picker-indicator]:hidden"
                />
              </div>
              <div>
                <label className="text-sm font-medium">To</label>
                <Input
                  type="datetime-local"
                  value={exportTo}
                  onChange={(event) => setExportTo(event.target.value)}
                  className="audit-date-input mt-1 [&::-webkit-calendar-picker-indicator]:hidden"
                />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <AuditOptionChecklist
                title="Actions"
                description="Leave empty to export all visible actions."
                options={actionOptions.map((action) => ({ value: action, label: action }))}
                selected={exportActions}
                onToggle={(value) => setExportActions((values) => toggleValue(values, value))}
                emptyMessage="No actions available."
              />
              <AuditOptionChecklist
                title="Resources"
                description="Leave empty to export all visible resources."
                options={resourceOptions.map((resourceType) => ({
                  value: resourceType,
                  label: resourceType,
                }))}
                selected={exportResourceTypes}
                onToggle={(value) => setExportResourceTypes((values) => toggleValue(values, value))}
                emptyMessage="No resources available."
              />
              <AuditOptionChecklist
                title="Users"
                description="Leave empty to export all users."
                options={userOptions.map((user) => ({ value: user.id, label: user.label }))}
                selected={exportUserIds}
                onToggle={(value) => setExportUserIds((values) => toggleValue(values, value))}
                emptyMessage="Load audit entries to populate users."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button onClick={() => void runExport()} disabled={exporting}>
              {exporting ? "Exporting..." : `Download ${exportFormat.toUpperCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="grid-rows-[auto,minmax(0,1fr)] max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Entry Details</DialogTitle>
          </DialogHeader>
          {selectedEntry ? (
            <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-3 text-sm sm:grid-cols-6">
                <AuditDetail
                  className="sm:col-span-2"
                  label="Action"
                  value={selectedEntry.action}
                />
                <AuditDetail
                  className="sm:col-span-2"
                  label="Time"
                  value={new Date(selectedEntry.createdAt).toLocaleString()}
                />
                <AuditDetail
                  className="sm:col-span-2"
                  label="Resource Type"
                  value={selectedEntry.resourceType}
                />
                <AuditDetail
                  className="sm:col-span-3"
                  label="Resource ID"
                  value={selectedEntry.resourceId}
                />
                <AuditDetail
                  className="sm:col-span-3"
                  label="User ID"
                  value={selectedEntry.userId}
                />
                <AuditDetail
                  className="sm:col-span-3"
                  label="User"
                  value={selectedEntry.userName || selectedEntry.userEmail || "System"}
                />
                <AuditDetail
                  className="sm:col-span-3"
                  label="IP Address"
                  value={selectedEntry.ipAddress}
                />
                {selectedEntry.userAgent && (
                  <AuditDetail
                    className="sm:col-span-6"
                    label="User Agent"
                    value={selectedEntry.userAgent}
                    wrap
                  />
                )}
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

function AuditDetail({
  label,
  value,
  className = "",
  wrap = false,
}: {
  label: string;
  value?: string | null;
  className?: string;
  wrap?: boolean;
}) {
  const displayValue = value || "-";
  return (
    <div className={`min-w-0 rounded-md border border-border p-3 ${className}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-xs ${wrap ? "break-all" : "truncate"}`} title={displayValue}>
        {displayValue}
      </p>
    </div>
  );
}

function AuditOptionChecklist({
  title,
  description,
  options,
  selected,
  onToggle,
  emptyMessage = "No options available.",
}: {
  title: string;
  description: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="min-h-0 border border-border">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {options.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
                className="h-4 w-4 accent-primary"
              />
              <span className="min-w-0 truncate font-mono text-xs" title={option.label}>
                {option.label}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
