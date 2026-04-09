import { Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { ProxyHost } from "@/types";

interface PinnedProxyCardProps {
  proxy: ProxyHost;
}

export function PinnedProxyCard({ proxy }: PinnedProxyCardProps) {
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
