import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsUpDown, ChevronDown, ChevronUp, Loader2, Minus, Plus, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import type { DatabaseConnection, PostgresTableMetadata } from "@/types";
import {
  buildPrimaryKey,
  coerceCellInput,
  getPendingRowState,
  getRowKey,
  isBlankValue,
  isPendingRowValid,
  POSTGRES_EXPLORER_PAGE_SIZE,
  stringifyCell,
  valuesEqual,
  VIRTUAL_ROW_HEIGHT,
} from "./shared";

export function PostgresExplorer({
  database,
  canWrite,
}: {
  database: DatabaseConnection;
  canWrite: boolean;
}) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [tables, setTables] = useState<Array<{ name: string; type: "table" | "view" }>>([]);
  const [table, setTable] = useState("");
  const [metadata, setMetadata] = useState<PostgresTableMetadata | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [draftRows, setDraftRows] = useState<Record<string, Record<string, unknown>>>({});
  const [newRows, setNewRows] = useState<Array<Record<string, unknown>>>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const [sortBy, setSortBy] = useState<string>();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const explorerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listPostgresSchemas(database.id).then((data) => {
      setSchemas(data);
      setSchema(data[0] ?? "public");
    });
  }, [database.id]);

  useEffect(() => {
    if (!schema) return;
    api.listPostgresTables(database.id, schema).then((data) => {
      setTables(data);
      setTable((current) =>
        data.some((item) => item.name === current) ? current : (data[0]?.name ?? "")
      );
      if (data.length === 0) {
        setMetadata(null);
        setRows([]);
        setDraftRows({});
        setNewRows([]);
      }
    });
  }, [database.id, schema]);

  const loadRows = useCallback(
    async (page = 1, append = false) => {
      if (!schema || !table) return;
      try {
        const data = await api.browsePostgresRows(database.id, {
          schema,
          table,
          page,
          limit: POSTGRES_EXPLORER_PAGE_SIZE,
          sortBy,
          sortOrder,
        });
        setMetadata(data.metadata);
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
        setCurrentPage(data.page);
        setTotalRows(data.total);
        if (!append) {
          setDraftRows({});
          setNewRows([]);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load rows");
      }
    },
    [database.id, schema, sortBy, sortOrder, table]
  );

  useEffect(() => {
    void loadRows(1, false);
  }, [loadRows]);

  const hasMoreRows = rows.length < totalRows;
  const loadMoreRows = useCallback(async () => {
    if (!hasMoreRows || loadingMoreRows || refreshing || saving) return;
    setLoadingMoreRows(true);
    try {
      await loadRows(currentPage + 1, true);
    } finally {
      setLoadingMoreRows(false);
    }
  }, [currentPage, hasMoreRows, loadRows, loadingMoreRows, refreshing, saving]);

  useEffect(() => {
    const node = explorerScrollRef.current;
    if (!node) return;

    const onScroll = () => {
      if (node.scrollTop + node.clientHeight >= node.scrollHeight - 320) {
        void loadMoreRows();
      }
    };

    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [loadMoreRows]);

  useEffect(() => {
    const node = explorerScrollRef.current;
    if (!node || !hasMoreRows || loadingMoreRows) return;
    if (node.scrollHeight <= node.clientHeight + 1) {
      void loadMoreRows();
    }
  }, [hasMoreRows, loadingMoreRows, loadMoreRows, rows.length]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => explorerScrollRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: 16,
    getItemKey: (index) => {
      if (!metadata) return index;
      return getRowKey(metadata, rows[index] ?? {});
    },
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const gridTemplateColumns = metadata
    ? `repeat(${metadata.columns.length}, minmax(180px, 1fr))`
    : "";

  useEffect(() => {
    if (metadata && sortBy && !metadata.columns.some((column) => column.name === sortBy)) {
      setSortBy(undefined);
      setSortOrder("asc");
    }
  }, [metadata, sortBy]);

  const editedRowCount = useMemo(
    () =>
      rows.reduce((count, row) => {
        const key = getRowKey(metadata!, row);
        return draftRows[key] ? count + 1 : count;
      }, 0),
    [draftRows, metadata, rows]
  );

  const validPendingRows = useMemo(
    () => (metadata ? newRows.filter((row) => isPendingRowValid(row, metadata.columns)) : []),
    [metadata, newRows]
  );
  const pendingRowStates = useMemo(
    () => (metadata ? newRows.map((row) => getPendingRowState(row, metadata.columns)) : []),
    [metadata, newRows]
  );
  const invalidPendingRowCount = pendingRowStates.filter((state) => state === "invalid").length;
  const emptyPendingRowCount = pendingRowStates.filter((state) => state === "empty").length;
  const dirtyCount = editedRowCount + validPendingRows.length;
  const canSaveChanges =
    !saving &&
    dirtyCount > 0 &&
    invalidPendingRowCount === 0 &&
    emptyPendingRowCount === 0;

  const updateDraftRow = (
    row: Record<string, unknown>,
    column: PostgresTableMetadata["columns"][number],
    raw: string
  ) => {
    if (!metadata) return;
    const key = getRowKey(metadata, row);
    const base = draftRows[key] ?? row;
    const nextDraft = {
      ...base,
      [column.name]: coerceCellInput(column, raw),
    };
    const matchesOriginal = metadata.columns.every((candidate) =>
      valuesEqual(nextDraft[candidate.name], row[candidate.name])
    );
    setDraftRows((prev) => {
      if (matchesOriginal) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: nextDraft,
      };
    });
  };

  const updateNewRow = (
    rowIndex: number,
    column: PostgresTableMetadata["columns"][number],
    raw: string
  ) => {
    setNewRows((prev) =>
      prev.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              [column.name]: coerceCellInput(column, raw),
            }
          : row
      )
    );
  };

  const saveChanges = async () => {
    if (!metadata || !schema || !table) return;
    setSaving(true);
    try {
      for (const row of rows) {
        const key = getRowKey(metadata, row);
        const draft = draftRows[key];
        if (!draft) continue;
        await api.updatePostgresRow(
          database.id,
          schema,
          table,
          buildPrimaryKey(metadata, row),
          draft
        );
      }
      for (const pendingRow of validPendingRows) {
        await api.insertPostgresRow(database.id, schema, table, pendingRow);
      }
      toast.success("Table changes saved");
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save table changes");
    } finally {
      setSaving(false);
    }
  };

  const refreshRows = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadRows(1, false), new Promise((resolve) => setTimeout(resolve, 500))]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSort = (columnName: string) => {
    if (sortBy === columnName) {
      if (sortOrder === "asc") {
        setSortOrder("desc");
        return;
      }
      setSortBy(undefined);
      setSortOrder("asc");
      return;
    }
    setSortBy(columnName);
    setSortOrder("asc");
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="flex flex-wrap items-end gap-3 shrink-0">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Schema</label>
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Table</label>
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Table" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name} ({item.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void refreshRows()} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {metadata ? (
        <div className="border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-full">
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">
                {metadata.schema}.{metadata.table}
              </h3>
              <p className="text-xs text-muted-foreground">
                {metadata.columns.length} columns
                {metadata.hasPrimaryKey
                  ? ` · editable grid`
                  : ` · no primary key, existing rows are browse-only`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setNewRows((prev) => [
                      ...prev,
                      Object.fromEntries(metadata.columns.map((column) => [column.name, null])),
                    ])
                  }
                  title="Insert row"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
              {canWrite && (
                <Button size="sm" onClick={() => void saveChanges()} disabled={!canSaveChanges}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
                </Button>
              )}
            </div>
          </div>

          <div ref={explorerScrollRef} className="overflow-auto flex-1 min-h-0">
            {metadata.columns.length > 0 && (
              <div
                className="grid border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card z-10"
                style={{ gridTemplateColumns }}
              >
                {metadata.columns.map((column) => (
                  <div key={column.name} className="border-r border-border last:border-r-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                      onClick={() => toggleSort(column.name)}
                      title={`Sort by ${column.name}`}
                    >
                      <span>{column.name}</span>
                      {column.isPrimaryKey && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          PK
                        </Badge>
                      )}
                      <span className="ml-auto text-muted-foreground/80">
                        {sortBy === column.name ? (
                          sortOrder === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const rowKey = getRowKey(metadata, row);
                const draft = draftRows[rowKey] ?? row;
                const isLastLoadedRow =
                  virtualRow.index === rows.length - 1 && newRows.length === 0 && !loadingMoreRows;

                return (
                  <div
                    key={rowKey}
                    ref={rowVirtualizer.measureElement}
                    className={`absolute inset-x-0 grid ${isLastLoadedRow ? "" : "border-b border-border"}`}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns,
                    }}
                  >
                    {metadata.columns.map((column, columnIndex) => {
                      const isLastColumn = columnIndex === metadata.columns.length - 1;
                      const canInlineDelete = canWrite && metadata.hasPrimaryKey && isLastColumn;

                      if (canWrite && metadata.hasPrimaryKey) {
                        if (canInlineDelete) {
                          return (
                            <div
                              key={column.name}
                              className="flex items-center border-r border-border last:border-r-0"
                            >
                              <Input
                                value={stringifyCell(draft[column.name])}
                                onChange={(event) =>
                                  updateDraftRow(row, column, event.target.value)
                                }
                                className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex-1 min-w-0"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                                onClick={() =>
                                  void api
                                    .deletePostgresRow(
                                      database.id,
                                      schema,
                                      table,
                                      buildPrimaryKey(metadata, row)
                                    )
                                    .then(() => {
                                      toast.success("Row deleted");
                                      return loadRows();
                                    })
                                    .catch((error) => {
                                      toast.error(
                                        error instanceof Error
                                          ? error.message
                                          : "Failed to delete row"
                                      );
                                    })
                                }
                                title="Delete row"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <div key={column.name} className="border-r border-border last:border-r-0">
                            <Input
                              value={stringifyCell(draft[column.name])}
                              onChange={(event) =>
                                updateDraftRow(row, column, event.target.value)
                              }
                              className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                            />
                          </div>
                        );
                      }

                      return (
                        <div key={column.name} className="border-r border-border last:border-r-0">
                          <div className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words min-h-9">
                            {stringifyCell(draft[column.name]) || (
                              <span className="text-muted-foreground">NULL</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div>
              {newRows.map((newRow, rowIndex) => (
                <div
                  key={`new-${rowIndex}`}
                  className={`grid border-border bg-emerald-500/5 ${
                    rowIndex === newRows.length - 1 ? "" : "border-b"
                  }`}
                  style={{ gridTemplateColumns }}
                >
                  {metadata.columns.map((column, columnIndex) => {
                    const isLastColumn = columnIndex === metadata.columns.length - 1;
                    const canInlineRemove = canWrite && isLastColumn;

                    if (canInlineRemove) {
                      return (
                        <div
                          key={column.name}
                          className="flex items-center border-r border-border last:border-r-0"
                        >
                          <Input
                            value={stringifyCell(newRow[column.name])}
                            onChange={(event) =>
                              updateNewRow(rowIndex, column, event.target.value)
                            }
                            className={`h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex-1 min-w-0 ${
                              pendingRowStates[rowIndex] === "invalid" &&
                              !column.nullable &&
                              !column.hasDefault &&
                              isBlankValue(newRow[column.name])
                                ? "bg-red-500/15 text-red-400"
                                : ""
                            }`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                            onClick={() =>
                              setNewRows((prev) => prev.filter((_, index) => index !== rowIndex))
                            }
                            title="Remove pending row"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    }

                    return (
                      <div key={column.name} className="border-r border-border last:border-r-0">
                        <Input
                          value={stringifyCell(newRow[column.name])}
                          onChange={(event) => updateNewRow(rowIndex, column, event.target.value)}
                          className={`h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                            pendingRowStates[rowIndex] === "invalid" &&
                            !column.nullable &&
                            !column.hasDefault &&
                            isBlankValue(newRow[column.name])
                              ? "bg-red-500/15 text-red-400"
                              : ""
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
              {loadingMoreRows && (
                <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more rows
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          No table selected.
        </div>
      )}
    </div>
  );
}
