import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { useRealtime } from "@/hooks/use-realtime";
import { daysUntil } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useNodesStore } from "@/stores/nodes";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import { usePinnedProxiesStore } from "@/stores/pinned-proxies";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type { AuditLogEntry, DashboardStats, Node, NodeHealthReport, ProxyHost } from "@/types";
import { CertificateAuthoritiesCard } from "./dashboard/CertificateAuthoritiesCard";
import { CertificateExpiryCard, type ExpiringItem } from "./dashboard/CertificateExpiryCard";
import { HealthOverviewCard } from "./dashboard/HealthOverviewCard";
import { NodesCard } from "./dashboard/NodesCard";
import { PinnedNodeCard, WARN_THRESHOLD } from "./dashboard/PinnedNodeCard";
import { PinnedProxyCard } from "./dashboard/PinnedProxyCard";
import { QuickStatsCard } from "./dashboard/QuickStatsCard";
import { RecentActivityCard } from "./dashboard/RecentActivityCard";

export function Dashboard() {
  const { user, hasScope, hasScopedAccess } = useAuthStore();
  const { cas, fetchCAs, isLoading: casLoading } = useCAStore();
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [healthHosts, setHealthHosts] = useState<ProxyHost[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(hasScope("admin:audit"));
  const [nodesLoading, setNodesLoading] = useState(hasScopedAccess("nodes:details"));
  const [healthLoading, setHealthLoading] = useState(hasScopedAccess("proxy:view"));
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const nodeRefreshTick = useNodesStore((s) => s.refreshTick);
  const dashboardPinnedIds = usePinnedNodesStore((s) => s.dashboardNodeIds);
  const dashboardPinnedProxyIds = usePinnedProxiesStore((s) => s.dashboardProxyIds);
  const [pinnedProxyHosts, setPinnedProxyHosts] = useState<ProxyHost[]>([]);
  const updateStatus = useUpdateStore((s) => s.status);
  const showUpdateNotifications = useUIStore((s) => s.showUpdateNotifications);
  const canViewSystemCertificates = useAuthStore((s) => s.hasScope("admin:details:certificates"));
  const showSystemCertificatePreference = useUIStore((s) => s.showSystemCertificates);
  const showSystemCertificates = canViewSystemCertificates && showSystemCertificatePreference;
  const cacheScopeKey = useMemo(
    () => `${user?.id ?? "anonymous"}:${[...(user?.scopes ?? [])].sort().join(",")}`,
    [user?.id, user?.scopes]
  );
  const canViewNodeDetails = useCallback(
    (nodeId: string) => hasScope("nodes:details") || hasScope(`nodes:details:${nodeId}`),
    [hasScope]
  );
  const canViewProxyDetails = useCallback(
    (hostId: string) => hasScope("proxy:view") || hasScope(`proxy:view:${hostId}`),
    [hasScope]
  );
  const canViewCAs = hasScope("pki:ca:view:root") || hasScope("pki:ca:view:intermediate");

  const refreshNodes = useCallback(() => {
    if (!hasScopedAccess("nodes:details")) {
      setNodesLoading(false);
      return;
    }
    api
      .listNodes({ limit: 100 })
      .then((r) => {
        const nodes = r.data ?? [];
        setNodesList(nodes);
        usePinnedNodesStore.getState().removeOrphans(nodes.map((n) => n.id));
      })
      .catch(() => {})
      .finally(() => setNodesLoading(false));
  }, [hasScopedAccess]);

  const refreshStats = useCallback(() => {
    const statsCacheKey = `dashboard:stats:${cacheScopeKey}:${showSystemCertificates ? "system" : "default"}`;
    return api
      .getDashboardStats(showSystemCertificates)
      .then((data) => {
        api.setCache(statsCacheKey, data);
        setStats(data);
      })
      .catch(() => {
        setStats(null);
      });
  }, [cacheScopeKey, showSystemCertificates]);

  const refreshHealthOverview = useCallback(() => {
    if (!hasScopedAccess("proxy:view")) {
      setHealthLoading(false);
      return Promise.resolve();
    }
    return api
      .getHealthOverview()
      .then((hosts) => {
        api.setCache(`dashboard:health:${cacheScopeKey}`, hosts || []);
        setHealthHosts(hosts || []);
      })
      .catch(() => setHealthHosts([]))
      .finally(() => setHealthLoading(false));
  }, [cacheScopeKey, hasScopedAccess]);

  const refreshExpiringSSL = useCallback(() => {
    if (!hasScopedAccess("ssl:cert:view")) return Promise.resolve();
    return api
      .listSSLCertificates({
        status: "active",
        limit: 100,
        showSystem: showSystemCertificates,
      })
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
  }, [hasScopedAccess, showSystemCertificates]);

  const refreshExpiringPKI = useCallback(() => {
    if (!hasScopedAccess("pki:cert:view")) return Promise.resolve();
    return api
      .listCertificates({ status: "active", limit: 100, showSystem: showSystemCertificates })
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
  }, [hasScopedAccess, showSystemCertificates]);

  const refreshPinnedProxies = useCallback(() => {
    if (dashboardPinnedProxyIds.length === 0) {
      setPinnedProxyHosts([]);
      return Promise.resolve();
    }
    if (!hasScopedAccess("proxy:view")) return Promise.resolve();
    return api
      .listProxyHosts({ limit: 100 })
      .then((r) => {
        const hosts = r.data ?? [];
        setPinnedProxyHosts(
          hosts.filter((p) => dashboardPinnedProxyIds.includes(p.id) && canViewProxyDetails(p.id))
        );
        usePinnedProxiesStore.getState().removeOrphans(hosts.map((p) => p.id));
      })
      .catch(() => {});
  }, [canViewProxyDetails, dashboardPinnedProxyIds, hasScopedAccess]);

  useEffect(() => {
    if (canViewCAs) {
      fetchCAs();
    }

    if (hasScope("admin:audit")) {
      api
        .getAuditLog({ limit: 6 })
        .then((r) => setActivity(r.data || []))
        .catch(() => {})
        .finally(() => setActivityLoading(false));
    } else {
      setActivityLoading(false);
    }

    // Use cached stats immediately, then refetch
    const statsCacheKey = `dashboard:stats:${cacheScopeKey}:${showSystemCertificates ? "system" : "default"}`;
    const cachedStats = api.getCached<DashboardStats>(statsCacheKey);
    if (cachedStats) {
      setStats(cachedStats);
      setStatsLoading(false);
    }
    refreshStats().finally(() => setStatsLoading(false));

    if (hasScopedAccess("proxy:view")) {
      const cachedHealth = api.getCached<ProxyHost[]>(`dashboard:health:${cacheScopeKey}`);
      if (cachedHealth) setHealthHosts(cachedHealth);
      refreshHealthOverview();
    }

    refreshExpiringSSL();
    refreshExpiringPKI();
  }, [
    cacheScopeKey,
    fetchCAs,
    hasScope,
    hasScopedAccess,
    canViewCAs,
    refreshExpiringPKI,
    refreshExpiringSSL,
    refreshHealthOverview,
    refreshStats,
    showSystemCertificates,
  ]);

  // Fetch/refetch nodes — also triggers on nodeRefreshTick from RealtimeBridge
  useEffect(() => {
    void nodeRefreshTick;
    refreshNodes();
  }, [refreshNodes, nodeRefreshTick]);

  useRealtime(hasScopedAccess("nodes:details") ? "node.changed" : null, () => {
    refreshNodes();
  });

  useRealtime(canViewCAs ? "ca.changed" : null, () => {
    fetchCAs();
    refreshStats();
  });

  useRealtime(hasScopedAccess("pki:cert:view") ? "cert.changed" : null, () => {
    if (canViewCAs) {
      fetchCAs();
    }
    refreshStats();
    refreshExpiringPKI();
  });

  useRealtime(hasScopedAccess("ssl:cert:view") ? "ssl.cert.changed" : null, () => {
    refreshStats();
    refreshExpiringSSL();
  });

  useRealtime(hasScopedAccess("proxy:view") ? "proxy.host.changed" : null, () => {
    refreshStats();
    refreshHealthOverview();
    refreshPinnedProxies();
  });

  // Fetch pinned proxy hosts
  useEffect(() => {
    refreshPinnedProxies();
  }, [refreshPinnedProxies]);

  // IDs of nodes shown on dashboard (pinned + disk warning)
  const warningNodeIds = useMemo(
    () =>
      nodesList
        .filter((n) => {
          if (!canViewNodeDetails(n.id)) return false;
          if (dashboardPinnedIds.includes(n.id)) return false;
          const disk = n.lastHealthReport?.diskMounts?.find((d) => d.mountPoint === "/");
          return disk ? disk.usagePercent >= WARN_THRESHOLD : false;
        })
        .map((n) => n.id),
    [canViewNodeDetails, dashboardPinnedIds, nodesList]
  );
  const dashboardVisibleIds = useMemo(
    () => [...dashboardPinnedIds.filter(canViewNodeDetails), ...warningNodeIds],
    [canViewNodeDetails, dashboardPinnedIds, warningNodeIds]
  );
  const visibleHealthHosts = useMemo(
    () => healthHosts.filter((host) => canViewProxyDetails(host.id)),
    [canViewProxyDetails, healthHosts]
  );
  const visibleNodesForCards = useMemo(
    () => nodesList.filter((node) => canViewNodeDetails(node.id)),
    [canViewNodeDetails, nodesList]
  );

  // Open monitoring SSE streams for visible dashboard nodes.
  const [pinnedHealth, setPinnedHealth] = useState<Record<string, NodeHealthReport>>({});
  const [nodeHealthHistory, setNodeHealthHistory] = useState<
    Record<string, Array<{ ts: string; status: string }>>
  >({});

  useEffect(() => {
    if (dashboardVisibleIds.length === 0) {
      setNodeHealthHistory({});
      return;
    }
    let cancelled = false;
    Promise.all(
      dashboardVisibleIds.map(async (nodeId) => {
        try {
          return [nodeId, await api.getNodeHealthHistory(nodeId)] as const;
        } catch {
          return [nodeId, []] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setNodeHealthHistory(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [dashboardVisibleIds]);

  useEffect(() => {
    if (!hasScopedAccess("nodes:details")) return;
    if (dashboardVisibleIds.length === 0) return;
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
  }, [dashboardVisibleIds, hasScopedAccess]);

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
    return <LoadingSpinner />;
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

          <QuickStatsCard
            displayStats={displayStats}
            nodesList={nodesList}
            hasScope={hasScopedAccess}
          />

          {/* Pinned Proxy Host Cards */}
          {pinnedProxyHosts
            .filter((proxy) => canViewProxyDetails(proxy.id))
            .map((proxy) => (
              <PinnedProxyCard key={proxy.id} proxy={proxy} />
            ))}

          {/* Pinned + Warning Node Overview Cards */}
          {visibleNodesForCards
            .filter((n) => {
              if (dashboardPinnedIds.includes(n.id)) return true;
              const disk = n.lastHealthReport?.diskMounts?.find((d) => d.mountPoint === "/");
              return disk ? disk.usagePercent >= WARN_THRESHOLD : false;
            })
            .map((node) => (
              <PinnedNodeCard
                key={node.id}
                node={node}
                liveHealth={pinnedHealth[node.id]}
                healthHistory={nodeHealthHistory[node.id]}
              />
            ))}

          <CertificateExpiryCard expiringItems={expiringItems} hasScope={hasScopedAccess} />

          <HealthOverviewCard
            healthHosts={visibleHealthHosts}
            hasScope={hasScopedAccess}
            loading={healthLoading}
          />

          <NodesCard
            nodesList={visibleNodesForCards}
            hasScope={hasScopedAccess}
            loading={nodesLoading}
          />

          <CertificateAuthoritiesCard cas={cas} hasScope={hasScope} />

          <RecentActivityCard activity={activity} hasScope={hasScope} loading={activityLoading} />
        </div>
      </div>
    </PageTransition>
  );
}
