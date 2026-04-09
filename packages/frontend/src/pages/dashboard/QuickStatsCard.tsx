import { Award, Globe, Lock, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { DashboardStats, Node } from "@/types";

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

interface QuickStatsCardProps {
  displayStats: DashboardStats;
  nodesList: Node[];
  hasScope: (scope: string) => boolean;
}

export function QuickStatsCard({ displayStats, nodesList, hasScope }: QuickStatsCardProps) {
  if (
    !hasScope("proxy:list") &&
    !hasScope("ssl:cert:list") &&
    !hasScope("pki:cert:list") &&
    !hasScope("nodes:list")
  ) {
    return null;
  }

  return (
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
      {hasScope("ssl:cert:list") && (
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
      {hasScope("pki:cert:list") && (
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
  );
}
