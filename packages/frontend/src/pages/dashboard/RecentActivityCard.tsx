import { Link } from "react-router-dom";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { formatRelativeDate } from "@/lib/utils";
import type { AuditLogEntry } from "@/types";

interface RecentActivityCardProps {
  activity: AuditLogEntry[];
  hasScope: (scope: string) => boolean;
  loading?: boolean;
}

export function RecentActivityCard({
  activity,
  hasScope,
  loading = false,
}: RecentActivityCardProps) {
  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold">Recent Activity</h2>
        {hasScope("admin:audit") && (
          <Link
            to="/administration/audit"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading activity...</p>
          </div>
        </div>
      ) : hasScope("admin:audit") && activity.length > 0 ? (
        <div className="overflow-x-auto -mb-px">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="p-3 text-xs font-medium text-muted-foreground">User</th>
                <th className="p-3 text-xs font-medium text-muted-foreground">Action</th>
                <th className="p-3 text-xs font-medium text-muted-foreground">Resource</th>
                <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activity.map((entry) => (
                <tr key={entry.id}>
                  <td className="p-3 text-sm">{entry.userName || entry.userEmail || "System"}</td>
                  <td className="p-3 text-sm">
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5">{entry.action}</span>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {entry.resourceType}
                    {entry.resourceId ? ` / ${entry.resourceId.slice(0, 8)}...` : ""}
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {formatRelativeDate(entry.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          {hasScope("admin:audit")
            ? "No recent activity"
            : "Activity log is available to administrators"}
        </div>
      )}
    </div>
  );
}
