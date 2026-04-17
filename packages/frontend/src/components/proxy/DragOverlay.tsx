import type { Active } from "@dnd-kit/core";
import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import { ProxyHostRow } from "./ProxyHostRow";

interface DragOverlayProps {
  active: Active | null;
  colGroup: React.ReactNode;
}

const noop = () => {};

export function DragOverlay({ active, colGroup }: DragOverlayProps) {
  if (!active) return null;

  const host = active.data.current?.host;
  if (!host) return null;

  return (
    <DndDragOverlay>
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
    </DndDragOverlay>
  );
}
