import { Link } from "react-router-dom";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import type { ProxyHost } from "@/types";

interface HealthOverviewCardProps {
  healthHosts: ProxyHost[];
  hasScope: (scope: string) => boolean;
  loading?: boolean;
}

export function HealthOverviewCard({
  healthHosts,
  hasScope,
  loading = false,
}: HealthOverviewCardProps) {
  if (!hasScope("proxy:view")) return null;

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold">Health Overview</h2>
        <Link to="/proxy-hosts" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading health overview...</p>
          </div>
        </div>
      ) : healthHosts.length > 0 ? (
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
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
                  )[(host.effectiveHealthStatus ?? host.healthStatus) as string] || "secondary"
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
  );
}
