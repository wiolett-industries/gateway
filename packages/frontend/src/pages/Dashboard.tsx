import { Award, CheckCircle, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { AuditLogEntry } from "@/types";
import { formatRelativeDate } from "@/lib/utils";

function StatCard({ title, value, icon: Icon, description }: {
  title: string; value: number; icon: React.ElementType; description?: string;
}) {
  return (
    <div className="border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    fetchCAs();
    if (hasRole("admin")) {
      api.getAuditLog({ limit: 10 }).then((r) => setActivity(r.data || [])).catch(() => {});
    }
  }, [fetchCAs, hasRole]);

  const activeCAs = (cas || []).filter((ca) => ca.status === "active").length;
  const totalCAs = (cas || []).length;
  const totalCerts = (cas || []).reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  if (isLoading) {
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
        <p className="text-sm text-muted-foreground">PKI infrastructure overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Active CAs" value={activeCAs} icon={Shield} description={`${totalCAs} total`} />
        <StatCard title="Certificates Issued" value={totalCerts} icon={Award} />
        <StatCard title="Active Authorities" value={activeCAs} icon={CheckCircle} />
      </div>

      {/* Recent Activity */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">Recent Activity</h2>
          {hasRole("admin") && (
            <Link to="/audit" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>
          )}
        </div>
        {activity.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Resource</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="p-3 text-sm">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5">{entry.action}</span>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {entry.resourceType}{entry.resourceId ? ` / ${entry.resourceId.slice(0, 8)}...` : ""}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{formatRelativeDate(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {hasRole("admin") ? "No recent activity" : "Activity log is available to administrators"}
          </div>
        )}
      </div>
    </div>
    </PageTransition>
  );
}
