import { ChevronDown, ChevronRight, Shield, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { CA } from "@/types";
import { cn } from "@/lib/utils";

interface CATreeProps {
  cas: CA[];
  onSelect: (id: string) => void;
  selectedId?: string;
}

function CATreeNode({
  ca,
  depth,
  onSelect,
  selectedId,
}: {
  ca: CA;
  depth: number;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = ca.children && ca.children.length > 0;
  const isSelected = selectedId === ca.id;

  const statusColor =
    ca.status === "active"
      ? "text-[color:var(--color-success)]"
      : ca.status === "revoked"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div>
      <button
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-sidebar-accent transition-colors text-left",
          isSelected && "bg-sidebar-accent font-medium"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(ca.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Shield className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />
        <span className="truncate flex-1">{ca.name}</span>
        {ca.status !== "active" && (
          <Badge
            variant="secondary"
            className={cn("text-[10px] px-1.5 py-0", ca.status === "revoked" && "text-destructive")}
          >
            {ca.status}
          </Badge>
        )}
      </button>
      {hasChildren && expanded && (
        <div>
          {ca.children!.map((child) => (
            <CATreeNode
              key={child.id}
              ca={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CATree({ cas, onSelect, selectedId }: CATreeProps) {
  // Build tree: only show root CAs at top level
  const rootCAs = cas.filter((ca) => !ca.parentId);

  if (rootCAs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4 text-center">
        <ShieldAlert className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No CAs</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {rootCAs.map((ca) => (
        <CATreeNode
          key={ca.id}
          ca={ca}
          depth={0}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ))}
    </div>
  );
}
