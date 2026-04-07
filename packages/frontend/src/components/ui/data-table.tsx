import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** If true, cell content will truncate with ellipsis */
  truncate?: boolean;
  /** Fixed width (e.g. "100px", "8rem"). Without this, columns share remaining space equally. */
  width?: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableGroup {
  key: string;
  label: ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Ref for scroll container (for infinite scroll sentinel) */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** Extra content at the bottom of the scroll area (e.g. sentinel) */
  footer?: ReactNode;
  /** Group rows by a key. Returns group info or null for ungrouped rows. */
  groupBy?: (row: T) => DataTableGroup | null;
  /** Called when a group header is clicked */
  onGroupClick?: (group: DataTableGroup) => void;
}

type FlatItem<T> =
  | { kind: "group"; key: string; group: DataTableGroup }
  | { kind: "row"; key: string; row: T };

const ROW_HEIGHT = 49;
const GROUP_HEIGHT = 41;

export function DataTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  emptyMessage = "No data.",
  scrollRef,
  footer,
  groupBy,
  onGroupClick,
}: DataTableProps<T>) {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? internalRef;

  // Build the flat row model: walk data once and synthesize group headers
  // whenever the group key changes. This becomes the index space the
  // virtualizer iterates over.
  const items = useMemo<FlatItem<T>[]>(() => {
    const out: FlatItem<T>[] = [];
    let prevGroupKey: string | null = null;
    for (const row of data) {
      const group = groupBy?.(row) ?? null;
      if (group && group.key !== prevGroupKey) {
        out.push({ kind: "group", key: `__group:${group.key}`, group });
        prevGroupKey = group.key;
      } else if (!group) {
        prevGroupKey = null;
      }
      out.push({ kind: "row", key: keyFn(row), row });
    }
    return out;
  }, [data, groupBy, keyFn]);

  const gridTemplateColumns = useMemo(
    () => columns.map((c) => c.width ?? "1fr").join(" "),
    [columns]
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => (items[index]?.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT),
    overscan: 8,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  // Re-measure when the row count or composition changes — TanStack handles
  // this automatically via the count change, but we explicitly invalidate the
  // size cache so estimates re-pick the correct kind on group transitions.
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (data.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="border border-border rounded-lg bg-card flex flex-col min-h-0 max-h-full overflow-hidden">
      <div ref={containerRef} className="overflow-y-auto min-h-0 -mb-px">
        {/* Sticky header — sibling of the virtualized body, sharing the same grid template */}
        <div
          className="sticky top-0 bg-card z-10 shadow-[inset_0_-1px_0_var(--color-border)] grid text-xs font-medium text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns }}
        >
          {columns.map((col) => (
            <div
              key={col.key}
              className={`${col.align === "right" ? "text-right" : "text-left"} px-4 py-2 font-medium`}
            >
              {col.header}
            </div>
          ))}
        </div>

        {/* Virtualized body */}
        <div style={{ height: totalSize, position: "relative" }}>
          {virtualItems.map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            const top = vi.start;

            if (item.kind === "group") {
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  className={`absolute left-0 right-0 grid bg-muted/50 border-b border-border ${
                    onGroupClick ? "cursor-pointer hover:bg-muted transition-colors" : ""
                  }`}
                  style={{
                    transform: `translateY(${top}px)`,
                    gridTemplateColumns: "1fr",
                  }}
                  onClick={onGroupClick ? () => onGroupClick(item.group) : undefined}
                >
                  <div className="px-4 py-2">{item.group.label}</div>
                </div>
              );
            }

            return (
              <Fragment key={item.key}>
                <div
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  className={`absolute left-0 right-0 grid border-b border-border transition-colors ${
                    onRowClick ? "cursor-pointer hover:bg-muted/50" : ""
                  }`}
                  style={{
                    transform: `translateY(${top}px)`,
                    gridTemplateColumns,
                  }}
                  onClick={onRowClick ? () => onRowClick(item.row) : undefined}
                >
                  {columns.map((col) => (
                    <div
                      key={col.key}
                      className={`px-4 py-3 text-sm ${col.align === "right" ? "text-right" : ""} ${
                        col.truncate ? "overflow-hidden text-ellipsis whitespace-nowrap min-w-0" : "min-w-0"
                      } ${col.className ?? ""}`}
                    >
                      {col.render(item.row)}
                    </div>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
        {footer}
      </div>
    </div>
  );
}
