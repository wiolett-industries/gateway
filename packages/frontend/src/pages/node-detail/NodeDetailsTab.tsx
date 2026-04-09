import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DetailRow } from "@/components/common/DetailRow";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatUptime } from "@/lib/utils";
import { api } from "@/services/api";
import type { DockerContainer, NodeDetail, NodeHealthReport, ProxyHost } from "@/types";

interface NodeDetailsTabProps {
  node: NodeDetail;
}

export function NodeDetailsTab({ node }: NodeDetailsTabProps) {
  const navigate = useNavigate();
  const [proxyHosts, setProxyHosts] = useState<ProxyHost[]>([]);
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
  const h: NodeHealthReport | null = node.liveHealthReport ?? node.lastHealthReport;
  const caps = (node.capabilities ?? {}) as Record<string, unknown>;
  const resourcesRef = useRef<HTMLDivElement>(null);
  const [resourcesHeight, setResourcesHeight] = useState(0);

  useEffect(() => {
    if (!resourcesRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setResourcesHeight(entry.contentRect.height + 2); // +2 for border
    });
    ro.observe(resourcesRef.current);
    return () => ro.disconnect();
  }, [h]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (node.type === "nginx") {
        try {
          const resp = await api.listProxyHosts({ nodeId: node.id, limit: 100 });
          if (!cancelled) setProxyHosts(resp.data ?? []);
        } catch {
          // optional
        }
      }
      if (node.type === "docker") {
        try {
          const data = await api.listDockerContainers(node.id);
          if (!cancelled) setDockerContainers(data ?? []);
        } catch {
          // optional
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [node.id, node.type]);

  return (
    <div className="space-y-4">
      {/* Docker Container Overview — docker nodes only */}
      {node.type === "docker" && dockerContainers.length > 0 && (
        <div className="border border-border bg-card">
          <div className="grid grid-cols-4 divide-x divide-border">
            {[
              { label: "Running", count: dockerContainers.filter((c) => c.state === "running").length },
              { label: "Stopped", count: dockerContainers.filter((c) => c.state === "exited" || c.state === "stopped").length },
              { label: "Paused", count: dockerContainers.filter((c) => c.state === "paused").length },
              { label: "Total", count: dockerContainers.length },
            ].map((s) => (
              <div key={s.label} className="p-4 text-center">
                <p className="text-2xl font-bold">{s.count}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Node Details — 2 cards side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Identity</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow
              label="Node ID"
              value={<span className="font-mono text-xs">{node.id}</span>}
            />
            <DetailRow label="Hostname" value={node.hostname} />
            <DetailRow
              label="Type"
              value={
                <Badge variant="secondary" className="text-xs uppercase">
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
          <div className="divide-y divide-border [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Daemon Version"
              value={
                node.daemonVersion ? (
                  <Badge variant="secondary" className="text-xs uppercase">
                    {node.daemonVersion}
                  </Badge>
                ) : (
                  "Unknown"
                )
              }
            />
            {node.type === "nginx" && (
              <DetailRow label="Nginx Version" value={String(caps.nginxVersion ?? "Unknown")} />
            )}
            {node.type === "docker" && (
              <DetailRow label="Docker Version" value={String(caps.dockerVersion ?? "Unknown")} />
            )}
            <DetailRow label="Created" value={new Date(node.createdAt).toLocaleString()} />
            <DetailRow
              label="Last Seen"
              value={node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "Never"}
            />
          </div>
        </div>
      </div>

      {/* System Stats */}
      {h && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:items-start">
          {/* Resources */}
          <div
            className="border border-border bg-card"
            ref={(el) => {
              if (el) resourcesRef.current = el;
            }}
          >
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">System Information</h2>
            </div>
            <div className="divide-y divide-border">
              {"cpuModel" in caps && <DetailRow label="CPU" value={String(caps.cpuModel)} />}
              {"cpuCores" in caps && <DetailRow label="CPU Cores" value={String(caps.cpuCores)} />}
              {"architecture" in caps && (
                <DetailRow label="Architecture" value={String(caps.architecture)} />
              )}
              {"kernelVersion" in caps && (
                <DetailRow label="Kernel" value={String(caps.kernelVersion)} />
              )}
              <DetailRow label="Uptime" value={formatUptime(h.systemUptimeSeconds)} />
              <DetailRow
                label="File Descriptors"
                value={`${h.openFileDescriptors.toLocaleString()} / ${h.maxFileDescriptors.toLocaleString()}`}
              />
            </div>
          </div>

          {/* Disk Mounts */}
          <div
            className="border border-border bg-card flex flex-col"
            style={{ height: resourcesHeight > 0 ? resourcesHeight : undefined }}
          >
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">Disk Mounts</h2>
            </div>
            {h.diskMounts && h.diskMounts.length > 0 ? (
              <div className="overflow-y-auto flex-1 min-h-0 -mb-px">
                {h.diskMounts.map((m) => (
                  <div key={m.mountPoint} className="px-4 py-3 space-y-1 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono">{m.mountPoint}</span>
                        {m.mountPoint === "/" && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            ROOT DISK
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(m.usagePercent)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${m.usagePercent >= 90 ? "bg-red-400" : m.usagePercent >= 80 ? "bg-yellow-500" : "bg-foreground"}`}
                        style={{ width: `${Math.min(m.usagePercent, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(m.usedBytes)} used</span>
                      <span>{formatBytes(m.totalBytes)} total</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No disk data</p>
            )}
          </div>
        </div>
      )}

      {/* Assigned Proxy Hosts — nginx nodes only */}
      {node.type === "nginx" && (
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
      )}

    </div>
  );
}


