import type { Active } from "@dnd-kit/core";
import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import { Folder, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DockerContainerRow } from "./DockerContainerRow";

const noop = () => {};

interface DockerDragOverlayProps {
  active: Active | null;
  colGroup: React.ReactNode;
}

export function DockerDragOverlay({ active, colGroup }: DockerDragOverlayProps) {
  if (!active) return null;
  const folder = active.data.current?.folder;
  const container = active.data.current?.container;

  return (
    <DndDragOverlay>
      {folder ? (
        <div className="flex min-w-80 items-center gap-2 border border-border bg-card px-3 py-2 shadow-lg opacity-95">
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
          {folder.isSystem && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="text-sm font-medium">{folder.name}</span>
          <Badge variant="secondary" className="ml-1 text-xs">
            {folder.containers.length}
          </Badge>
        </div>
      ) : container ? (
        <table
          className="w-full bg-card border border-border shadow-lg opacity-95"
          style={{ tableLayout: "fixed" }}
        >
          {colGroup}
          <tbody>
            <DockerContainerRow
              container={container}
              canView
              canManage
              canReorganize
              showNode={!!container._nodeName}
              onStart={noop}
              onStop={noop}
              onRestart={noop}
              onMoveToFolder={noop}
              isOverlay
            />
          </tbody>
        </table>
      ) : null}
    </DndDragOverlay>
  );
}
