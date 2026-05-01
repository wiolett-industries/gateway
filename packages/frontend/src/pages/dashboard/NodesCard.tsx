import { Link } from "react-router-dom";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import type { Node } from "@/types";
import { effectiveNodeStatus } from "@/types";

interface NodesCardProps {
  nodesList: Node[];
  hasScope: (scope: string) => boolean;
  loading?: boolean;
}

export function NodesCard({ nodesList, hasScope, loading = false }: NodesCardProps) {
  if (!hasScope("nodes:details")) return null;

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold">Nodes</h2>
        <Link to="/nodes" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">Loading nodes...</p>
          </div>
        </div>
      ) : nodesList.length > 0 ? (
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
          {nodesList.slice(0, 8).map((node) => (
            <Link
              key={node.id}
              to={`/nodes/${node.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm font-medium truncate flex-1">
                {node.displayName || node.hostname}
              </span>
              <Badge variant="secondary" className="text-xs uppercase">
                {node.type}
              </Badge>
              {node.daemonVersion && (
                <Badge variant="outline" className="text-xs uppercase">
                  {node.daemonVersion}
                </Badge>
              )}
              {(() => {
                const s = effectiveNodeStatus(node);
                const v =
                  s === "online"
                    ? "success"
                    : s === "degraded"
                      ? "warning"
                      : s === "pending"
                        ? "secondary"
                        : "destructive";
                return (
                  <Badge variant={v} className="text-xs uppercase">
                    {s}
                  </Badge>
                );
              })()}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
