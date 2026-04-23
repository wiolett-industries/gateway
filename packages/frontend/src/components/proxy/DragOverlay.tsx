import type { Active } from "@dnd-kit/core";
import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import { Folder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProxyHostRow } from "./ProxyHostRow";

interface DragOverlayProps {
  active: Active | null;
  colGroup: React.ReactNode;
}

const noop = () => {};

export function DragOverlay({ active, colGroup }: DragOverlayProps) {
  if (!active) return null;

  const folder = active.data.current?.folder;
  const host = active.data.current?.host;

  return (
    <DndDragOverlay>
      {folder ? (
        <div className="flex min-w-80 items-center gap-2 border border-border bg-card px-3 py-2 shadow-lg opacity-95">
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">{folder.name}</span>
          <Badge variant="secondary" className="ml-1 text-xs">
            {folder.hosts.length}
          </Badge>
        </div>
      ) : host ? (
        <table
          className="w-full bg-card border border-border shadow-lg opacity-95"
          style={{ tableLayout: "fixed" }}
        >
          {colGroup}
          <tbody>
            <ProxyHostRow
              host={host}
              onToggle={noop}
              togglingIds={new Set()}
              onMoveToFolder={noop}
              isOverlay
            />
          </tbody>
        </table>
      ) : null}
    </DndDragOverlay>
  );
}
