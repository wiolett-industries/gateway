import {
  AlertTriangle,
  Award,
  CheckCircle,
  Clock,
  Plus,
  Shield,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATree } from "@/components/ca/CATree";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { Alert, AuditLogEntry, DashboardStats } from "@/types";
import { formatRelativeDate } from "@/lib/utils";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  variant = "default",
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  description?: string;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const variantClasses = {
    default: "text-foreground",
    success: "text-[color:var(--color-success)]",
    warning: "text-[color:var(--color-warning)]",
    destructive: "text-destructive",
  };

  return (
    <div className="border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className={`h-4 w-4 ${variantClasses[variant]}`} />
      </div>
      <p className={`text-2xl font-bold ${variantClasses[variant]}`}>{value}</p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function AlertItem({ alert }: { alert: Alert }) {
  const severityClasses = {
    info: "bg-secondary",
    warning: "bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]",
    critical: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="flex items-start gap-3 py-2">
      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${
        alert.severity === "critical" ? "text-destructive" :
        alert.severity === "warning" ? "text-[color:var(--color-warning)]" :
        "text-muted-foreground"
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{alert.title}</p>
        <p className="text-xs text-muted-foreground">{alert.message}</p>
      </div>
      <Badge variant="secondary" className={severityClasses[alert.severity]}>
        {alert.severity}
      </Badge>
    </div>
  );
}

function ActivityItem({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="h-2 w-2 mt-1.5 shrink-0 bg-primary rounded-full" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{entry.actorName}</span>{" "}
          <span className="text-muted-foreground">{entry.action.replace(".", " ")}</span>{" "}
          <span className="font-medium">{entry.resourceName}</span>
        </p>
        <p className="text-xs text-muted-foreground">{formatRelativeDate(entry.createdAt)}</p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs } = useCAStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [statsData] = await Promise.all([
          api.getDashboardStats(),
          fetchCAs(),
        ]);
        setStats(statsData);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [fetchCAs]);

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">PKI infrastructure overview</p>
        </div>
        {hasRole("admin", "operator") && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create CA
          </Button>
        )}
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active CAs"
            value={stats.activeCAs}
            icon={Shield}
            description={`${stats.totalCAs} total`}
            variant="success"
          />
          <StatCard
            title="Active Certificates"
            value={stats.activeCertificates}
            icon={CheckCircle}
            description={`${stats.totalCertificates} total`}
            variant="success"
          />
          <StatCard
            title="Expiring Soon"
            value={stats.expiringCertificates}
            icon={Clock}
            description="Within 30 days"
            variant={stats.expiringCertificates > 0 ? "warning" : "default"}
          />
          <StatCard
            title="Revoked"
            value={stats.revokedCertificates}
            icon={XCircle}
            variant={stats.revokedCertificates > 0 ? "destructive" : "default"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* CA Hierarchy */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-semibold">CA Hierarchy</h2>
            <Link to="/certificates" className="text-sm text-[color:var(--color-link)] hover:underline">
              View all
            </Link>
          </div>
          <div className="p-4">
            {cas.length > 0 ? (
              <CATree cas={cas} onSelect={(id) => navigate(`/cas/${id}`)} />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ShieldAlert className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No certificate authorities yet</p>
                {hasRole("admin", "operator") && (
                  <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Create Root CA
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-semibold">Alerts</h2>
            <Badge variant="secondary">
              {stats?.alerts.filter((a) => !a.acknowledged).length ?? 0} active
            </Badge>
          </div>
          <div className="p-4">
            {stats && stats.alerts.length > 0 ? (
              <div className="divide-y divide-border">
                {stats.alerts.slice(0, 5).map((alert) => (
                  <AlertItem key={alert.id} alert={alert} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle className="h-8 w-8 text-[color:var(--color-success)]" />
                <p className="text-sm text-muted-foreground">No active alerts</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="border border-border bg-card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-semibold">Recent Activity</h2>
            {hasRole("admin") && (
              <Link to="/audit" className="text-sm text-[color:var(--color-link)] hover:underline">
                View audit log
              </Link>
            )}
          </div>
          <div className="p-4">
            {stats && stats.recentActivity.length > 0 ? (
              <div className="divide-y divide-border">
                {stats.recentActivity.slice(0, 10).map((entry) => (
                  <ActivityItem key={entry.id} entry={entry} />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No recent activity</p>
            )}
          </div>
        </div>
      </div>

      <CACreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
