import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import type { Active } from "@dnd-kit/core";
import { ProxyHostRow } from "./ProxyHostRow";

interface DragOverlayProps {
  active: Active | null;
}

const noop = () => {};

export function DragOverlay({ active }: DragOverlayProps) {
  if (!active) return null;

  const host = active.data.current?.host;
  if (!host) return null;

  return (
    <DndDragOverlay>
      <table className="w-full bg-card border border-border shadow-lg opacity-95">
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
