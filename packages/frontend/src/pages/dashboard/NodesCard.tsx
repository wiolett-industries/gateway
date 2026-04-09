import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { Node, NodeStatus } from "@/types";

interface NodesCardProps {
  nodesList: Node[];
  hasScope: (scope: string) => boolean;
}

export function NodesCard({ nodesList, hasScope }: NodesCardProps) {
  if (!hasScope("nodes:list") || nodesList.length === 0) return null;

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold">Nodes</h2>
        <Link to="/nodes" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
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
            <Badge
              variant={
                (
                  {
                    online: "success",
                    offline: "warning",
                    pending: "secondary",
                    error: "destructive",
                  } as Record<NodeStatus, "success" | "warning" | "secondary" | "destructive">
                )[node.status] || "secondary"
              }
              className="text-xs uppercase"
            >
              {node.status === "online" ? "healthy" : node.status}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
