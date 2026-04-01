import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import type { NodeDetail, NodeHealthReport, ProxyHost } from "@/types";

interface NodeDetailsTabProps {
  node: NodeDetail;
}

export function NodeDetailsTab({ node }: NodeDetailsTabProps) {
  const navigate = useNavigate();
  const [proxyHosts, setProxyHosts] = useState<ProxyHost[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await api.listProxyHosts({ nodeId: node.id, limit: 100 });
        if (!cancelled) setProxyHosts(resp.data ?? []);
      } catch {
        // optional
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const health = node.liveHealthReport ?? node.lastHealthReport;

  return (
    <div className="space-y-4">
      {/* Health Status — status page style */}
      <HealthStatusCard health={health} nodeStatus={node.status} node={node} />

      {/* Node Details — 2 cards side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Identity</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow label="Node ID" value={<span className="font-mono">{node.id}</span>} />
            <DetailRow label="Hostname" value={node.hostname} />
            <DetailRow
              label="Type"
              value={
                <Badge variant="secondary" className="text-xs capitalize">
                  {node.type}
                </Badge>
              }
            />
            {node.osInfo && <DetailRow label="OS" value={node.osInfo} />}
          </div>
        </div>

        {/* Runtime */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Runtime</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow
              label="Daemon Version"
              value={node.daemonVersion ? `v${node.daemonVersion}` : "Unknown"}
            />
            <DetailRow
              label="Nginx Version"
              value={String(
                (node.capabilities as Record<string, unknown>)?.nginxVersion ?? "Unknown"
              )}
            />
            <DetailRow label="Created" value={new Date(node.createdAt).toLocaleString()} />
            <DetailRow
              label="Last Seen"
              value={node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "Never"}
            />
          </div>
        </div>
      </div>

      {/* Assigned Proxy Hosts — same pattern as CA issued certificates */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">Assigned Proxy Hosts</h2>
          <Badge variant="secondary">{proxyHosts.length}</Badge>
        </div>
        {proxyHosts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">Domain</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Target</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proxyHosts.map((host) => (
                  <tr
                    key={host.id}
                    className="hover:bg-accent transition-colors cursor-pointer"
                    onClick={() => navigate(`/proxy-hosts/${host.id}`)}
                  >
                    <td className="p-3 text-sm font-medium">{host.domainNames.join(", ")}</td>
                    <td className="p-3 text-sm text-muted-foreground capitalize">{host.type}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {host.forwardHost
                        ? `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`
                        : "—"}
                    </td>
                    <td className="p-3 align-middle">
                      <Badge variant={host.enabled ? "success" : "secondary"} className="text-xs">
                        {host.enabled ? "active" : "disabled"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No proxy hosts assigned yet
          </p>
        )}
      </div>
    </div>
  );
}

/** Status page-style uptime bar backed by real health history */
function HealthStatusCard({
  health,
  nodeStatus,
  node,
}: {
  health: NodeHealthReport | null;
  nodeStatus: string;
  node: NodeDetail;
}) {
  const isHealthy = nodeStatus === "online" && (health?.nginxRunning ?? false);

  const now = new Date();
  const historyMap = new Map(node.healthHistory?.map((h) => [h.hour, h.healthy]) ?? []);

  function buildHours(count: number): Array<"ok" | "error" | "none"> {
    const result: Array<"ok" | "error" | "none"> = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600000);
      const hourKey = `${d.toISOString().slice(0, 13)}:00:00.000Z`;
      const status = historyMap.get(hourKey);
      result.push(status === true ? "ok" : status === false ? "error" : "none");
    }
    return result;
  }

  const hours96 = buildHours(96);
  const hours48 = buildHours(48);

  const barClass = (status: "ok" | "error" | "none") =>
    `h-8 flex-1 ${status === "ok" ? "bg-emerald-500" : status === "error" ? "bg-destructive" : "bg-muted"}`;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <h2 className="font-semibold">Node Health</h2>
        <Badge variant={isHealthy ? "success" : "destructive"} className="text-xs">
          {isHealthy ? "Operational" : "Unhealthy"}
        </Badge>
      </div>
      <div className="p-4">
        {/* 96h on md+, 48h on small */}
        <div className="hidden md:flex gap-[1px]">
          {hours96.map((status, i) => (
            <div
              key={i}
              className={barClass(status)}
              title={new Date(now.getTime() - (95 - i) * 3600000).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
          ))}
        </div>
        <div className="flex md:hidden gap-[1px]">
          {hours48.map((status, i) => (
            <div
              key={i}
              className={barClass(status)}
              title={new Date(now.getTime() - (47 - i) * 3600000).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
          <span className="hidden md:inline">96 hours ago</span>
          <span className="md:hidden">48 hours ago</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
