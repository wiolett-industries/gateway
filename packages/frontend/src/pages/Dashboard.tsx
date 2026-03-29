import { ArrowRight, Award, Globe, Lock, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/types";
import { cn, daysUntil, formatDate, formatRelativeDate, formatTimeLeft } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { AuditLogEntry, DashboardStats, ProxyHost, UpdateStatus } from "@/types";

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
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading: casLoading } = useCAStore();
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [healthHosts, setHealthHosts] = useState<ProxyHost[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    fetchCAs();

    if (hasRole("admin")) {
      api.getVersionInfo().then(setUpdateStatus).catch(() => {});
    }

    if (hasRole("admin")) {
      api
        .getAuditLog({ limit: 6 })
        .then((r) => setActivity(r.data || []))
        .catch(() => {});
    }

    // Fetch gateway stats with fallback to CA-derived data
    api
      .getDashboardStats()
      .then((data) => setStats(data))
      .catch(() => {
        // API not yet available — derive stats from CAs
        setStats(null);
      })
      .finally(() => setStatsLoading(false));

    api
      .getHealthOverview()
      .then((hosts) => setHealthHosts(hosts || []))
      .catch(() => setHealthHosts([]));

    // Fetch expiring SSL certs
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

    // Fetch expiring PKI certs
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
  }, [fetchCAs, hasRole]);

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
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Gateway and PKI infrastructure overview</p>
        </div>

        {/* Update available */}
        {updateStatus?.updateAvailable && updateStatus.latestVersion && (
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Proxy Hosts"
            value={displayStats.proxyHosts.total}
            icon={Globe}
            subtitle={`${displayStats.proxyHosts.online} online, ${displayStats.proxyHosts.offline} offline`}
            href="/proxy-hosts"
          />
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
          <StatCard
            title="PKI Certificates"
            value={displayStats.pkiCertificates.active}
            icon={Award}
            subtitle={`${displayStats.pkiCertificates.total} total`}
            href="/certificates"
          />
          <StatCard
            title="Certificate Authorities"
            value={displayStats.cas.active}
            icon={Shield}
            subtitle={`${displayStats.cas.total} total`}
            href="/cas"
          />
        </div>

        {/* Expiring Soon */}
        {expiringItems.length > 0 && (
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
                {expiringItems.length}
              </Badge>
            </div>
            <div className="divide-y divide-border">
              {[...expiringItems]
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
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-semibold">Health Overview</h2>
            <Link to="/proxy-hosts" className="text-sm text-muted-foreground hover:text-foreground">
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
                  <Badge variant={({ online: "success", offline: "destructive", degraded: "warning", unknown: "secondary", disabled: "outline" } as const)[host.healthStatus as HealthStatus] || "secondary"} className="text-xs capitalize">
                    {host.healthStatus}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No proxy hosts configured.{" "}
              <Link to="/proxy-hosts/new" className="text-foreground hover:underline">
                Add one
              </Link>
            </div>
          )}
        </div>

        {/* Certificate Authorities */}
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
                    <span className="text-xs text-muted-foreground">{ca.certCount || 0} certs</span>
                  </Link>
                ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No certificate authorities configured.{" "}
              <Link to="/cas" className="text-foreground hover:underline">
                Create one
              </Link>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-semibold">Recent Activity</h2>
            {hasRole("admin") && (
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
              {hasRole("admin")
                ? "No recent activity"
                : "Activity log is available to administrators"}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
