import { Link } from "react-router-dom";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PanelShell } from "@/components/common/PanelShell";
import { SimpleTable, type SimpleTableColumn } from "@/components/common/SimpleTable";
import { Badge } from "@/components/ui/badge";
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
  const activityColumns: SimpleTableColumn<AuditLogEntry>[] = [
    {
      id: "user",
      header: "User",
      render: (entry) => entry.userName || entry.userEmail || "System",
    },
    {
      id: "action",
      header: "Action",
      render: (entry) => <Badge variant="secondary">{entry.action}</Badge>,
    },
    {
      id: "resource",
      header: "Resource",
      cellClassName: "text-muted-foreground",
      render: (entry) =>
        `${entry.resourceType}${entry.resourceId ? ` / ${entry.resourceId.slice(0, 8)}...` : ""}`,
    },
    {
      id: "time",
      header: "Time",
      cellClassName: "text-muted-foreground",
      render: (entry) => formatRelativeDate(entry.createdAt),
    },
  ];

  return (
    <PanelShell
      title="Recent Activity"
      actions={
        hasScope("admin:audit") ? (
          <Link
            to="/administration/audit"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading activity...</p>
          </div>
        </div>
      ) : hasScope("admin:audit") && activity.length > 0 ? (
        <SimpleTable
          columns={activityColumns}
          rows={activity}
          getRowKey={(entry) => entry.id}
          tableClassName="min-w-[640px]"
        />
      ) : (
        <EmptyState
          message={
            hasScope("admin:audit")
              ? "No recent activity"
              : "Activity log is available to administrators"
          }
          embedded
        />
      )}
    </PanelShell>
  );
}
