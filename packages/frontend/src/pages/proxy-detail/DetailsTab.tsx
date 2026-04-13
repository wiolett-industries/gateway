import { Server } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DetailRow } from "@/components/common/DetailRow";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import type { ProxyHost } from "@/types";
import { effectiveHealthStatus, HEALTH_BADGE, HEALTH_LABEL } from "./helpers";

export function DetailsTab({ host }: { host: ProxyHost }) {
  const navigate = useNavigate();
  const nodeId = (host as any).nodeId as string | null;
  const [nodeInfo, setNodeInfo] = useState<{
    id: string;
    name: string;
    status: string;
    type: string;
  } | null>(null);

  useEffect(() => {
    if (!nodeId) return;
    api
      .getNode(nodeId)
      .then((n) =>
        setNodeInfo({ id: n.id, name: n.displayName || n.hostname, status: n.status, type: n.type })
      )
      .catch(() => {});
  }, [nodeId]);

  return (
    <div className="space-y-4">
      {/* Node Card */}
      {nodeInfo && (
        <div
          className="border border-border bg-card cursor-pointer hover:bg-accent transition-colors"
          onClick={() => navigate(`/nodes/${nodeInfo.id}`)}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{nodeInfo.name}</p>
                <p className="text-xs text-muted-foreground">Deployed on this node</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs uppercase">
                {nodeInfo.type}
              </Badge>
              <Badge
                variant={
                  nodeInfo.status === "online"
                    ? "success"
                    : nodeInfo.status === "offline" || nodeInfo.status === "error"
                      ? "destructive"
                      : "warning"
                }
                className="text-xs uppercase"
              >
                {nodeInfo.status}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* Host Info + Health Check in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Host Info Card */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Host Information</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow
              label="Domains"
              value={
                <div className="flex flex-wrap gap-1 justify-end">
                  {host.domainNames.map((d) => (
                    <Badge key={d} variant="secondary" className="text-xs">
                      {d}
                    </Badge>
                  ))}
                </div>
              }
            />
            {host.type === "proxy" && host.forwardHost && (
              <DetailRow
                label="Forward Target"
                value={`${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`}
              />
            )}
            {host.type === "redirect" && host.redirectUrl && (
              <DetailRow
                label="Redirect URL"
                value={`${host.redirectUrl} (${host.redirectStatusCode})`}
              />
            )}
            <DetailRow label="Created" value={new Date(host.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(host.updatedAt).toLocaleString()} />
          </div>
        </div>

        {/* Health Check Status Card */}
        {host.healthCheckEnabled && (
          <div className="border border-border bg-card">
            <div className="border-b border-border p-4 flex items-center justify-between">
              <h2 className="font-semibold">Health Check</h2>
              {(() => {
                const eff = effectiveHealthStatus(host);
                return (
                  <Badge variant={HEALTH_BADGE[eff] ?? "secondary"} className="text-xs">
                    {HEALTH_LABEL[eff] ?? eff}
                  </Badge>
                );
              })()}
            </div>
            <div className="divide-y divide-border">
              <DetailRow label="URL Path" value={host.healthCheckUrl || "/"} />
              <DetailRow label="Interval" value={`${host.healthCheckInterval || 30}s`} />
              <DetailRow
                label="Expected Status"
                value={
                  host.healthCheckExpectedStatus
                    ? String(host.healthCheckExpectedStatus)
                    : "Any 2xx"
                }
              />
              {host.lastHealthCheckAt && (
                <DetailRow
                  label="Last Check"
                  value={new Date(host.lastHealthCheckAt).toLocaleString()}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* SSL Certificate Info (when SSL enabled) */}
      {host.sslEnabled && host.sslCertificate && (
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">SSL Certificate</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow label="Name" value={host.sslCertificate.name} />
            <DetailRow
              label="Type"
              value={
                <Badge variant="secondary" className="text-xs">
                  {host.sslCertificate.type}
                </Badge>
              }
            />
            <DetailRow
              label="Status"
              value={
                <Badge
                  variant={host.sslCertificate.status === "active" ? "success" : "destructive"}
                  className="text-xs"
                >
                  {host.sslCertificate.status}
                </Badge>
              }
            />
            {host.sslCertificate.notAfter && (
              <DetailRow
                label="Expires"
                value={new Date(host.sslCertificate.notAfter).toLocaleString()}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
