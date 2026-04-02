import { ArrowRight, Award, Cpu, Globe, HardDrive, Lock, MemoryStick, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { HealthBars } from "@/components/ui/health-bars";
import { StatCard as MetricCard } from "@/components/ui/stat-card";
import { cn, daysUntil, formatDate, formatRelativeDate, formatTimeLeft } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import { usePinnedProxiesStore } from "@/stores/pinned-proxies";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type {
  AuditLogEntry,
  DashboardStats,
  Node,
  NodeHealthReport,
  NodeStatus,
  ProxyHost,
} from "@/types";

interface ExpiringItem {
  id: string;
  name: string;
  type: "ca" | "pki" | "ssl";
  expiresAt: string;
  daysLeft: number;
}

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  href,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  subtitle?: string;
  href?: string;
}) {
  const content = (
    <div
      className={cn(
        "border border-border bg-card p-4 space-y-2",
        href && "cursor-pointer hover:bg-accent transition-colors"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
  if (href) return <Link to={href}>{content}</Link>;
  return content;
}

export function Dashboard() {
  const { hasScope } = useAuthStore();
  const { cas, fetchCAs, isLoading: casLoading } = useCAStore();
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [healthHosts, setHealthHosts] = useState<ProxyHost[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const dashboardPinnedIds = usePinnedNodesStore((s) => s.dashboardNodeIds);
  const dashboardPinnedProxyIds = usePinnedProxiesStore((s) => s.dashboardProxyIds);
  const [pinnedProxyHosts, setPinnedProxyHosts] = useState<ProxyHost[]>([]);
  const updateStatus = useUpdateStore((s) => s.status);
  const showUpdateNotifications = useUIStore((s) => s.showUpdateNotifications);

  useEffect(() => {
    if (hasScope("ca:read")) {
      fetchCAs();
    }

    if (hasScope("nodes:list")) {
      api
        .listNodes({ limit: 100 })
        .then((r) => setNodesList(r.data ?? []))
        .catch(() => {});
    }

    if (hasScope("admin:audit")) {
      api
        .getAuditLog({ limit: 6 })
        .then((r) => setActivity(r.data || []))
        .catch(() => {});
    }

    // Use cached stats immediately, then refetch
    const cachedStats = api.getCached<DashboardStats>("dashboard:stats");
    if (cachedStats) {
      setStats(cachedStats);
      setStatsLoading(false);
    }
    api
      .getDashboardStats()
      .then((data) => {
        api.setCache("dashboard:stats", data);
        setStats(data);
      })
      .catch(() => {
        setStats(null);
      })
      .finally(() => setStatsLoading(false));

    if (hasScope("proxy:list")) {
      const cachedHealth = api.getCached<ProxyHost[]>("dashboard:health");
      if (cachedHealth) setHealthHosts(cachedHealth);
      api
        .getHealthOverview()
        .then((hosts) => {
          api.setCache("dashboard:health", hosts || []);
          setHealthHosts(hosts || []);
        })
        .catch(() => setHealthHosts([]));
    }

    // Fetch expiring SSL certs
    if (hasScope("ssl:read")) {
      api
        .listSSLCertificates({ status: "active", limit: 100 })
        .then((res) => {
          const expiring = (res.data || [])
            .filter((c) => c.notAfter && daysUntil(c.notAfter) <= 30 && daysUntil(c.notAfter) >= 0)
            .map((c) => ({
              id: c.id,
              name: c.name,
              type: "ssl" as const,
              expiresAt: c.notAfter!,
              daysLeft: daysUntil(c.notAfter!),
            }));
          setExpiringItems((prev) => [...prev.filter((i) => i.type !== "ssl"), ...expiring]);
        })
        .catch(() => {});
    }

    // Fetch expiring PKI certs
    if (hasScope("cert:read")) {
      api
        .listCertificates({ status: "active", limit: 100 })
        .then((res) => {
          const expiring = (res.data || [])
            .filter((c) => daysUntil(c.notAfter) <= 30 && daysUntil(c.notAfter) >= 0)
            .map((c) => ({
              id: c.id,
              name: c.commonName,
              type: "pki" as const,
              expiresAt: c.notAfter,
              daysLeft: daysUntil(c.notAfter),
            }));
          setExpiringItems((prev) => [...prev.filter((i) => i.type !== "pki"), ...expiring]);
        })
        .catch(() => {});
    }
  }, [fetchCAs, hasScope]);

  // Fetch pinned proxy hosts
  useEffect(() => {
    if (dashboardPinnedProxyIds.length === 0) {
      setPinnedProxyHosts([]);
      return;
    }
    if (!hasScope("proxy:list")) return;
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => {
        setPinnedProxyHosts((r.data ?? []).filter((p) => dashboardPinnedProxyIds.includes(p.id)));
      })
      .catch(() => {});
  }, [dashboardPinnedProxyIds, hasScope]);

  // IDs of nodes shown on dashboard (pinned + disk warning)
  const warningNodeIds = nodesList
    .filter((n) => {
      if (dashboardPinnedIds.includes(n.id)) return false; // already pinned
      const disk = n.lastHealthReport?.diskMounts?.find((d) => d.mountPoint === "/");
      return disk ? disk.usagePercent >= WARN_THRESHOLD : false;
    })
    .map((n) => n.id);
  const dashboardVisibleIds = [...dashboardPinnedIds, ...warningNodeIds];

  // Open monitoring SSE streams for visible dashboard nodes.
  // Triggers 5s health polling on the backend (registerClient) and
  // updates node health data in real-time via snapshots.
  const [pinnedHealth, setPinnedHealth] = useState<Record<string, NodeHealthReport>>({});
  useEffect(() => {
    if (dashboardVisibleIds.length === 0 || !hasScope("nodes:list")) return;
    const streams: EventSource[] = [];
    for (const nodeId of dashboardVisibleIds) {
      const es = api.createNodeMonitoringStream(nodeId);
      es.addEventListener("snapshot", (e) => {
        try {
          const snap = JSON.parse((e as MessageEvent).data);
          if (snap.health) {
            setPinnedHealth((prev) => ({ ...prev, [nodeId]: snap.health }));
          }
        } catch {}
      });
      streams.push(es);
    }
    return () => streams.forEach((es) => es.close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardVisibleIds.join(","), hasScope]);

  // Collect expiring CAs from store
  useEffect(() => {
    const expiringCAs = (cas || [])
      .filter(
        (ca) =>
          ca.status === "active" && daysUntil(ca.notAfter) <= 30 && daysUntil(ca.notAfter) >= 0
      )
      .map((ca) => ({
        id: ca.id,
        name: ca.commonName,
        type: "ca" as const,
        expiresAt: ca.notAfter,
        daysLeft: daysUntil(ca.notAfter),
      }));
    setExpiringItems((prev) => [...prev.filter((i) => i.type !== "ca"), ...expiringCAs]);
  }, [cas]);

  // Derive fallback stats from CA store when API stats not available
  const activeCAs = (cas || []).filter((ca) => ca.status === "active").length;
  const totalCAs = (cas || []).length;
  const totalCerts = (cas || []).reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  const displayStats: DashboardStats = stats ?? {
    proxyHosts: { total: 0, enabled: 0, online: 0, offline: 0, degraded: 0 },
    sslCertificates: { total: 0, active: 0, expiringSoon: 0, expired: 0 },
    pkiCertificates: { total: totalCerts, active: totalCerts, revoked: 0, expired: 0 },
    cas: { total: totalCAs, active: activeCAs },
  };

  if (casLoading && statsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Gateway and PKI infrastructure overview</p>
        </div>
        <div className="space-y-6">
          {/* Update available */}
          {updateStatus?.updateAvailable &&
            updateStatus.latestVersion &&
            showUpdateNotifications && (
              <div className="border bg-card" style={{ borderColor: "rgb(234 179 8 / 0.6)" }}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm" style={{ color: "rgb(234 179 8)" }}>
                      Update Available
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {updateStatus.latestVersion} is ready to install
                    </span>
                  </div>
                  <Link
                    to="/settings"
                    className="flex items-center gap-1 text-sm font-medium hover:underline"
                    style={{ color: "rgb(234 179 8)" }}
                  >
                    Go to Settings
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}

          {/* Stat cards */}
          {(hasScope("proxy:list") ||
            hasScope("ssl:read") ||
            hasScope("cert:read") ||
            hasScope("nodes:list")) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {hasScope("proxy:list") && (
                <StatCard
                  title="Proxy Hosts"
                  value={displayStats.proxyHosts.total}
                  icon={Globe}
                  subtitle={`${displayStats.proxyHosts.online} online, ${displayStats.proxyHosts.offline} offline`}
                  href="/proxy-hosts"
                />
              )}
              {hasScope("ssl:read") && (
                <StatCard
                  title="SSL Certificates"
                  value={displayStats.sslCertificates.total}
                  icon={Lock}
                  subtitle={
                    displayStats.sslCertificates.expiringSoon > 0
                      ? `${displayStats.sslCertificates.expiringSoon} expiring soon`
                      : "All certificates valid"
                  }
                  href="/ssl-certificates"
                />
              )}
              {hasScope("cert:read") && (
                <StatCard
                  title="PKI Certificates"
                  value={displayStats.pkiCertificates.active}
                  icon={Award}
                  subtitle={`${displayStats.pkiCertificates.total} total`}
                  href="/certificates"
                />
              )}
              {hasScope("nodes:list") && (
                <StatCard
                  title="Nodes"
                  value={nodesList.filter((n) => n.status === "online").length}
                  icon={Server}
                  subtitle={`${nodesList.length} registered`}
                  href="/nodes"
                />
              )}
            </div>
          )}

          {/* Expiring Soon */}
          {expiringItems.filter((i) =>
            i.type === "ssl"
              ? hasScope("ssl:read")
              : i.type === "pki"
                ? hasScope("cert:read")
                : hasScope("ca:read")
          ).length > 0 && (
            <div className="border bg-card" style={{ borderColor: "rgb(234 179 8 / 0.6)" }}>
              <div className="flex items-center gap-2 border-b border-border p-4">
                <h2 className="font-semibold" style={{ color: "rgb(234 179 8)" }}>
                  Expiring Soon
                </h2>
                <Badge
                  variant="warning"
                  className="ml-auto"
                  style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                >
                  {
                    expiringItems.filter((i) =>
                      i.type === "ssl"
                        ? hasScope("ssl:read")
                        : i.type === "pki"
                          ? hasScope("cert:read")
                          : hasScope("ca:read")
                    ).length
                  }
                </Badge>
              </div>
              <div className="divide-y divide-border">
                {[...expiringItems]
                  .filter((i) =>
                    i.type === "ssl"
                      ? hasScope("ssl:read")
                      : i.type === "pki"
                        ? hasScope("cert:read")
                        : hasScope("ca:read")
                  )
                  .sort((a, b) => a.daysLeft - b.daysLeft)
                  .map((item) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      to={
                        item.type === "ca"
                          ? `/cas/${item.id}`
                          : item.type === "pki"
                            ? `/certificates/${item.id}`
                            : "/ssl-certificates"
                      }
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm font-medium truncate flex-1">{item.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {item.type === "ca" ? "CA" : item.type === "pki" ? "PKI" : "SSL"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(item.expiresAt)}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          item.daysLeft <= 7
                            ? "text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {formatTimeLeft(item.expiresAt)}
                      </span>
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {/* Health Overview */}
          {hasScope("proxy:list") && (
            <div className="border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="font-semibold">Health Overview</h2>
                <Link
                  to="/proxy-hosts"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  View all
                </Link>
              </div>
              {healthHosts.length > 0 ? (
                <div className="divide-y divide-border">
                  {healthHosts.slice(0, 6).map((host) => (
                    <Link
                      key={host.id}
                      to={`/proxy-hosts/${host.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm font-medium truncate flex-1">
                        {host.domainNames.join(", ")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {host.forwardHost
                          ? `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`
                          : ""}
                      </span>
                      <Badge
                        variant={
                          (
                            {
                              online: "success",
                              offline: "destructive",
                              degraded: "warning",
                              recovering: "warning",
                              unknown: "secondary",
                              disabled: "outline",
                            } as const
                          )[(host.effectiveHealthStatus ?? host.healthStatus) as string] ||
                          "secondary"
                        }
                        className="text-xs uppercase"
                      >
                        {(host.effectiveHealthStatus ?? host.healthStatus) === "online"
                          ? "healthy"
                          : (host.effectiveHealthStatus ?? host.healthStatus)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No proxy hosts configured.{" "}
                  {hasScope("proxy:create") && (
                    <Link to="/proxy-hosts/new" className="text-foreground hover:underline">
                      Add one
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nodes Status */}
          {hasScope("nodes:list") && nodesList.length > 0 && (
            <div className="border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="font-semibold">Nodes</h2>
                <Link to="/nodes" className="text-sm text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              </div>
              <div className="divide-y divide-border">
                {nodesList.slice(0, 8).map((node) => (
                  <Link
                    key={node.id}
                    to={`/nodes/${node.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm font-medium truncate flex-1">
                      {node.displayName || node.hostname}
                    </span>
                    <Badge variant="secondary" className="text-xs uppercase">
                      {node.type}
                    </Badge>
                    {node.daemonVersion && (
                      <Badge variant="outline" className="text-xs uppercase">
                        {node.daemonVersion}
                      </Badge>
                    )}
                    <Badge
                      variant={
                        (
                          {
                            online: "success",
                            offline: "warning",
                            pending: "secondary",
                            error: "destructive",
                          } as Record<
                            NodeStatus,
                            "success" | "warning" | "secondary" | "destructive"
                          >
                        )[node.status] || "secondary"
                      }
                      className="text-xs uppercase"
                    >
                      {node.status === "online" ? "healthy" : node.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Pinned Proxy Host Cards */}
          {pinnedProxyHosts.map((proxy) => (
            <PinnedProxyCard key={proxy.id} proxy={proxy} />
          ))}

          {/* Pinned + Warning Node Overview Cards */}
          {nodesList
            .filter((n) => {
              if (dashboardPinnedIds.includes(n.id)) return true;
              // Show unpinned nodes that have disk usage >= 80%
              const disk = n.lastHealthReport?.diskMounts?.find((d) => d.mountPoint === "/");
              return disk ? disk.usagePercent >= WARN_THRESHOLD : false;
            })
            .map((node) => (
              <PinnedNodeCard key={node.id} node={node} liveHealth={pinnedHealth[node.id]} />
            ))}

          {/* Certificate Authorities */}
          {hasScope("ca:read") && (
            <div className="border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="font-semibold">Certificate Authorities</h2>
                <Link to="/cas" className="text-sm text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              </div>
              {(cas || []).length > 0 ? (
                <div className="divide-y divide-border">
                  {(cas || [])
                    .filter((ca) => ca.status === "active")
                    .slice(0, 6)
                    .map((ca) => (
                      <Link
                        key={ca.id}
                        to={`/cas/${ca.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-sm font-medium truncate flex-1">{ca.commonName}</span>
                        <span className="text-xs text-muted-foreground">
                          {ca.type === "root" ? "Root" : "Intermediate"}
                        </span>
                        <span className="text-xs text-muted-foreground">{ca.keyAlgorithm}</span>
                        <span className="text-xs text-muted-foreground">
                          {ca.certCount || 0} certs
                        </span>
                      </Link>
                    ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No certificate authorities configured.{" "}
                  {hasScope("ca:create:root") && (
                    <Link to="/cas" className="text-foreground hover:underline">
                      Create one
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recent Activity */}
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="font-semibold">Recent Activity</h2>
              {hasScope("admin:audit") && (
                <Link to="/audit" className="text-sm text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              )}
            </div>
            {activity.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-3 text-xs font-medium text-muted-foreground">User</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Action</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Resource</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activity.map((entry) => (
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
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatRelativeDate(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {hasScope("admin:audit")
                  ? "No recent activity"
                  : "Activity log is available to administrators"}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

const WARN_THRESHOLD = 80;
const WARN_COLOR = "rgb(234 179 8)";
const WARN_BORDER = "rgb(234 179 8 / 0.6)";

function warnStyle(pct: number): {
  style?: React.CSSProperties;
  valueColor?: string;
  progressColor?: string;
} {
  if (pct < WARN_THRESHOLD) return {};
  return {
    style: {
      border: `1px solid ${WARN_BORDER}`,
      margin: "-1px",
      position: "relative" as const,
      zIndex: 1 as number,
    },
    progressColor: WARN_COLOR,
  };
}

function PinnedNodeCard({ node, liveHealth }: { node: Node; liveHealth?: NodeHealthReport }) {
  const h = liveHealth ?? node.lastHealthReport;
  const statusColor =
    node.status === "online" ? "success" : node.status === "error" ? "destructive" : "warning";

  const memPercent =
    h && h.systemMemoryTotalBytes > 0
      ? Math.round((h.systemMemoryUsedBytes / h.systemMemoryTotalBytes) * 100)
      : 0;
  const rootDisk = h?.diskMounts?.find((d) => d.mountPoint === "/");
  const diskPercent = rootDisk ? Math.round(rootDisk.usagePercent) : 0;
  const cpuPercent = h ? Math.min(Math.round(h.cpuPercent), 100) : 0;

  const cpuWarn = warnStyle(cpuPercent);
  const memWarn = warnStyle(memPercent);
  const diskWarn = warnStyle(diskPercent);

  return (
    <div className="grid grid-cols-4 border border-border bg-card overflow-visible">
      {/* Node info — clickable, navigates to node detail */}
      <Link
        to={`/nodes/${node.id}`}
        className="border-r border-border p-4 space-y-2 overflow-hidden cursor-pointer hover:bg-accent transition-colors"
      >
        <p className="text-xs text-muted-foreground truncate">
          {node.hostname}, {node.type}
        </p>
        <p className="text-xl font-bold truncate">{node.displayName || node.hostname}</p>
        <div className="flex items-center gap-2">
          <HealthBars hourlyHistory={node.healthHistory} showLabels={false} className="flex-1" />
          <Badge
            variant={statusColor}
            className="text-xs uppercase h-6"
            style={{ border: "1px solid rgb(16 185 129)" }}
          >
            {node.status === "online" ? "healthy" : node.status}
          </Badge>
        </div>
      </Link>
      <MetricCard
        label="CPU"
        value={h ? `${h.cpuPercent.toFixed(1)}%` : "—"}
        icon={Cpu}
        progress={h ? { percent: cpuPercent, color: cpuWarn.progressColor } : undefined}
        valueColor={cpuWarn.valueColor}
        className="border-0 border-r border-border"
        style={cpuWarn.style}
      />
      <MetricCard
        label="Memory"
        value={h ? `${memPercent}%` : "—"}
        icon={MemoryStick}
        progress={h ? { percent: memPercent, color: memWarn.progressColor } : undefined}
        subtitle={
          h
            ? `${formatBytes(h.systemMemoryUsedBytes)} / ${formatBytes(h.systemMemoryTotalBytes)}`
            : undefined
        }
        valueColor={memWarn.valueColor}
        className="border-0 border-r border-border"
        style={memWarn.style}
      />
      <MetricCard
        label="Disk"
        value={rootDisk ? `${diskPercent}%` : "—"}
        icon={HardDrive}
        progress={rootDisk ? { percent: diskPercent, color: diskWarn.progressColor } : undefined}
        subtitle={
          rootDisk
            ? `${formatBytes(rootDisk.usedBytes)} / ${formatBytes(rootDisk.totalBytes)}`
            : undefined
        }
        valueColor={diskWarn.valueColor}
        className="border-0"
        style={diskWarn.style}
      />
    </div>
  );
}

function PinnedProxyCard({ proxy }: { proxy: ProxyHost }) {
  const eff = (proxy as any).effectiveHealthStatus ?? proxy.healthStatus;
  const statusColor =
    eff === "online"
      ? "success"
      : eff === "recovering"
        ? "warning"
        : eff === "offline" || eff === "degraded"
          ? "destructive"
          : "secondary";
  const statusLabel = eff === "online" ? "healthy" : eff;

  return (
    <Link
      to={`/proxy-hosts/${proxy.id}`}
      className="flex items-center justify-between border border-border bg-card px-4 py-3 hover:bg-accent transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{proxy.domainNames[0]}</p>
          <p className="text-xs text-muted-foreground truncate">
            {proxy.domainNames.length > 1 ? `+${proxy.domainNames.length - 1} more` : null}
            {proxy.type === "proxy" && proxy.forwardHost
              ? `${proxy.domainNames.length > 1 ? " · " : ""}${proxy.forwardScheme}://${proxy.forwardHost}:${proxy.forwardPort}`
              : null}
            {proxy.type === "redirect" && proxy.redirectUrl
              ? `${proxy.domainNames.length > 1 ? " · " : ""}→ ${proxy.redirectUrl}`
              : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="secondary" className="text-xs uppercase">
          {proxy.type}
        </Badge>
        <Badge variant={statusColor} className="text-xs uppercase">
          {statusLabel}
        </Badge>
      </div>
    </Link>
  );
}
