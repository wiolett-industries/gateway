import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import type { NodeDetail, ProxyHost } from "@/types";

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

  return (
    <div className="space-y-4">
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


function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
