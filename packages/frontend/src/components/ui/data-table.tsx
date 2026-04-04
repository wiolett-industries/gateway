import { Fragment, type ReactNode } from "react";

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
  if (data.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card flex flex-col min-h-0 max-h-full overflow-hidden">
      <div ref={scrollRef} className="overflow-y-auto min-h-0 -mb-px">
        <table className="w-full text-sm">
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-card z-10 shadow-[inset_0_-1px_0_var(--color-border)]">
            <tr className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.align === "right" ? "text-right" : "text-left"} px-4 py-2 font-medium`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const group = groupBy?.(row) ?? null;
              const prevGroup = i > 0 ? groupBy?.(data[i - 1]) ?? null : null;
              const showHeader = group && group.key !== prevGroup?.key;

              return (
                <Fragment key={keyFn(row)}>
                  {showHeader && (
                    <tr
                      className={`bg-muted/50 border-b border-border ${onGroupClick ? "cursor-pointer hover:bg-muted transition-colors" : ""}`}
                      onClick={onGroupClick ? () => onGroupClick(group) : undefined}
                    >
                      <td colSpan={columns.length} className="px-4 py-2">
                        {group.label}
                      </td>
                    </tr>
                  )}
                  <tr
                    className={`border-b border-border transition-colors ${
                      onRowClick ? "cursor-pointer hover:bg-muted/50" : ""
                    }`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${col.align === "right" ? "text-right" : ""} ${col.truncate ? "overflow-hidden text-ellipsis whitespace-nowrap max-w-0" : ""} ${col.className ?? ""}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {footer}
      </div>
    </div>
  );
}
