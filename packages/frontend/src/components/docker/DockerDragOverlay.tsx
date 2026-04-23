import type { Active } from "@dnd-kit/core";
import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import { DockerContainerRow } from "./DockerContainerRow";

const noop = () => {};

interface DockerDragOverlayProps {
  active: Active | null;
  colGroup: React.ReactNode;
}

export function DockerDragOverlay({ active, colGroup }: DockerDragOverlayProps) {
  if (!active) return null;
  const container = active.data.current?.container;
  if (!container) return null;

  return (
    <DndDragOverlay>
      <table className="w-full bg-card border border-border shadow-lg opacity-95" style={{ tableLayout: "fixed" }}>
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
    </DndDragOverlay>
  );
}
