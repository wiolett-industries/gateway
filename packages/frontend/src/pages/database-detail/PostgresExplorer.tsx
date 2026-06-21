import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
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
import { PostgresColumnSchemaDialog } from "./PostgresColumnSchemaDialog";
import {
  currentColumnTypeValue,
  type NewColumnDraft,
  POSTGRES_IDENTIFIER_PATTERN,
  POSTGRES_SEARCH_OPERATIONS,
  type PostgresSearchOperation,
} from "./postgres-explorer-state";
import {
  buildPrimaryKey,
  coerceCellInput,
  getPendingRowState,
  getRowKey,
  isBlankValue,
  isPendingRowValid,
  POSTGRES_EXPLORER_PAGE_SIZE,
  stringifyCell,
  VIRTUAL_ROW_HEIGHT,
  valuesEqual,
} from "./shared";

export function PostgresExplorer({
  database,
  canWrite,
  canAdmin,
  focused,
  onToggleFocus,
}: {
  database: DatabaseConnection;
  canWrite: boolean;
  canAdmin: boolean;
  focused: boolean;
  onToggleFocus: () => void;
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
  const [loadingSchemas, setLoadingSchemas] = useState(true);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [changingColumn, setChangingColumn] = useState<string | null>(null);
  const [columnTypeDrafts, setColumnTypeDrafts] = useState<Record<string, string>>({});
  const [newColumnDrafts, setNewColumnDrafts] = useState<NewColumnDraft[]>([]);
  const [deletedColumnNames, setDeletedColumnNames] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const [sortBy, setSortBy] = useState<string>();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchColumn, setSearchColumn] = useState("");
  const [searchOperation, setSearchOperation] = useState<PostgresSearchOperation>("like");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearchColumn, setAppliedSearchColumn] = useState("");
  const [appliedSearchOperation, setAppliedSearchOperation] =
    useState<PostgresSearchOperation>("like");
  const [searchValue, setSearchValue] = useState("");
  const explorerScrollRef = useRef<HTMLDivElement>(null);
  const rowRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingSchemas(true);
    setSchemas([]);
    setSchema("");
    setTables([]);
    setTable("");
    setMetadata(null);
    setRows([]);
    setDraftRows({});
    setNewRows([]);
    setCurrentPage(1);
    setTotalRows(0);
    setSearchColumn("");
    setSearchInput("");
    setAppliedSearchColumn("");
    setAppliedSearchOperation("like");
    setSearchValue("");
    api
      .listPostgresSchemas(database.id)
      .then((data) => {
        if (cancelled) return;
        setSchemas(data);
        setSchema(data[0] ?? "public");
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load schemas");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSchemas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database.id]);

  useEffect(() => {
    if (!schema) return;
    let cancelled = false;
    setLoadingTables(true);
    setTables([]);
    setTable("");
    setMetadata(null);
    setRows([]);
    setDraftRows({});
    setNewRows([]);
    setCurrentPage(1);
    setTotalRows(0);
    setSearchColumn("");
    setSearchInput("");
    setAppliedSearchColumn("");
    setAppliedSearchOperation("like");
    setSearchValue("");
    api
      .listPostgresTables(database.id, schema)
      .then((data) => {
        if (cancelled) return;
        setTables(data);
        setTable(data[0]?.name ?? "");
        if (data.length === 0) {
          setMetadata(null);
          setRows([]);
          setDraftRows({});
          setNewRows([]);
          setCurrentPage(1);
          setTotalRows(0);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load tables");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database.id, schema]);

  useEffect(() => {
    if (schema) return;
    setLoadingTables(false);
    setTables([]);
    setTable("");
    setMetadata(null);
    setRows([]);
    setDraftRows({});
    setNewRows([]);
    setCurrentPage(1);
    setTotalRows(0);
    setSearchColumn("");
    setSearchInput("");
    setAppliedSearchColumn("");
    setAppliedSearchOperation("like");
    setSearchValue("");
  }, [schema]);

  useEffect(() => {
    if (table) return;
    if (!loadingSchemas && !loadingTables) {
      setLoadingRows(false);
      setMetadata(null);
      setRows([]);
      setDraftRows({});
      setNewRows([]);
      setCurrentPage(1);
      setTotalRows(0);
    }
  }, [loadingSchemas, loadingTables, table]);

  const activeSearchColumn = searchValue ? appliedSearchColumn : "";
  const activeSearchOperation = searchValue ? appliedSearchOperation : "like";

  const loadRows = useCallback(
    async (page = 1, append = false) => {
      if (!schema || !table) return;
      const requestId = ++rowRequestRef.current;
      if (!append) setLoadingRows(true);
      try {
        const data = await api.browsePostgresRows(database.id, {
          schema,
          table,
          page,
          limit: POSTGRES_EXPLORER_PAGE_SIZE,
          sortBy,
          sortOrder,
          ...(activeSearchColumn && searchValue
            ? {
                searchColumn: activeSearchColumn,
                searchOperation: activeSearchOperation,
                searchValue,
              }
            : {}),
        });
        if (rowRequestRef.current !== requestId) return;
        setMetadata(data.metadata);
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
        setCurrentPage(data.page);
        setTotalRows(data.total);
        if (!append) {
          setDraftRows({});
          setNewRows([]);
        }
      } catch (error) {
        if (rowRequestRef.current !== requestId) return;
        toast.error(error instanceof Error ? error.message : "Failed to load rows");
        if (!append) {
          setMetadata(null);
          setRows([]);
          setDraftRows({});
          setNewRows([]);
          setCurrentPage(1);
          setTotalRows(0);
        }
      } finally {
        if (!append && rowRequestRef.current === requestId) setLoadingRows(false);
      }
    },
    [
      activeSearchColumn,
      activeSearchOperation,
      database.id,
      schema,
      searchValue,
      sortBy,
      sortOrder,
      table,
    ]
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
  }, [hasMoreRows, loadingMoreRows, loadMoreRows]);

  const loadingExplorer = loadingSchemas || loadingTables || loadingRows;

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
  const columnMinWidth = 220;
  const gridTemplateColumns = metadata
    ? `repeat(${metadata.columns.length}, minmax(${columnMinWidth}px, 1fr))`
    : "";
  const gridWidth = metadata ? `max(100%, ${metadata.columns.length * columnMinWidth}px)` : "100%";
  const currentTableType = tables.find((candidate) => candidate.name === table)?.type;
  const canChangeColumnTypes = canAdmin && currentTableType === "table";

  useEffect(() => {
    if (metadata && sortBy && !metadata.columns.some((column) => column.name === sortBy)) {
      setSortBy(undefined);
      setSortOrder("asc");
    }
  }, [metadata, sortBy]);

  useEffect(() => {
    if (!metadata) return;
    if (metadata.columns.length === 0) {
      setSearchColumn("");
      return;
    }
    if (!searchColumn || !metadata.columns.some((column) => column.name === searchColumn)) {
      setSearchColumn(metadata.columns[0]?.name ?? "");
    }
  }, [metadata, searchColumn]);

  useEffect(() => {
    if (!columnsOpen || !metadata) return;
    setColumnTypeDrafts(
      Object.fromEntries(
        metadata.columns.map((column) => [column.name, currentColumnTypeValue(column)])
      )
    );
    setNewColumnDrafts([]);
    setDeletedColumnNames([]);
  }, [columnsOpen, metadata]);

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
    !saving && dirtyCount > 0 && invalidPendingRowCount === 0 && emptyPendingRowCount === 0;
  const invalidNewColumnIds = useMemo(() => {
    const seen = new Set(
      metadata?.columns
        .filter((column) => !deletedColumnNames.includes(column.name))
        .map((column) => column.name) ?? []
    );
    const invalid = new Set<string>();
    for (const draft of newColumnDrafts) {
      const name = draft.name.trim();
      if (!name || !POSTGRES_IDENTIFIER_PATTERN.test(name) || seen.has(name)) {
        invalid.add(draft.id);
      }
      if (name) seen.add(name);
    }
    return invalid;
  }, [deletedColumnNames, metadata, newColumnDrafts]);
  const changedColumnTypes = useMemo(() => {
    if (!metadata) return [];
    return metadata.columns
      .map((column) => ({
        column,
        dataType: columnTypeDrafts[column.name] ?? currentColumnTypeValue(column),
      }))
      .filter(
        ({ column, dataType }) =>
          !deletedColumnNames.includes(column.name) && dataType !== currentColumnTypeValue(column)
      );
  }, [columnTypeDrafts, deletedColumnNames, metadata]);
  const schemaChangeCount =
    changedColumnTypes.length + deletedColumnNames.length + newColumnDrafts.length;
  const canSaveColumnSchemaChanges =
    canChangeColumnTypes &&
    changingColumn === null &&
    schemaChangeCount > 0 &&
    invalidNewColumnIds.size === 0;

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
        const changedValues = Object.fromEntries(
          metadata.columns
            .filter((column) => !valuesEqual(draft[column.name], row[column.name]))
            .map((column) => [column.name, draft[column.name]])
        );
        await api.updatePostgresRow(
          database.id,
          schema,
          table,
          buildPrimaryKey(metadata, row),
          changedValues
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

  const applySearch = () => {
    setAppliedSearchColumn(searchColumn);
    setAppliedSearchOperation(searchOperation);
    setSearchValue(searchInput.trim());
  };

  const updateSearchInput = (value: string) => {
    setSearchInput(value);
    if (value.length === 0) {
      setSearchValue("");
    }
  };

  const resetColumnSchemaDrafts = () => {
    setColumnTypeDrafts(
      Object.fromEntries(
        metadata?.columns.map((column) => [column.name, currentColumnTypeValue(column)]) ?? []
      )
    );
    setNewColumnDrafts([]);
    setDeletedColumnNames([]);
  };

  const saveColumnSchemaChanges = async () => {
    if (!metadata || !schema || !table || !canChangeColumnTypes) return;
    if (!canSaveColumnSchemaChanges) return;
    try {
      let nextMetadata = metadata;
      for (const columnName of deletedColumnNames) {
        setChangingColumn(columnName);
        nextMetadata = await api.deletePostgresColumn(database.id, schema, table, columnName);
      }
      for (const change of changedColumnTypes) {
        setChangingColumn(change.column.name);
        nextMetadata = await api.updatePostgresColumnType(
          database.id,
          schema,
          table,
          change.column.name,
          change.dataType
        );
      }
      for (const draft of newColumnDrafts) {
        const columnName = draft.name.trim();
        setChangingColumn(columnName);
        nextMetadata = await api.addPostgresColumn(
          database.id,
          schema,
          table,
          columnName,
          draft.dataType
        );
      }
      setMetadata(nextMetadata);
      toast.success("Column schema updated");
      setNewColumnDrafts([]);
      setDeletedColumnNames([]);
      await loadRows(1, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update columns");
    } finally {
      setChangingColumn(null);
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
    <div className={`flex flex-col flex-1 min-h-0 ${focused ? "gap-0" : "gap-4"}`}>
      {!focused && (
        <div className="grid shrink-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_auto] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <div className="min-w-0">
            <Select value={schema} onValueChange={setSchema} disabled={loadingSchemas}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder={loadingSchemas ? "Loading schemas..." : "Schema"} />
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
          <div className="min-w-0">
            <Select value={table} onValueChange={setTable} disabled={loadingTables || !schema}>
              <SelectTrigger className="w-full sm:w-[260px]">
                <SelectValue placeholder={loadingTables ? "Loading tables..." : "Table"} />
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
          <Button
            variant="outline"
            size="icon"
            className="sm:w-auto sm:px-4"
            onClick={() => void refreshRows()}
            disabled={refreshing || loadingExplorer || !table}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing || loadingRows ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      )}

      {loadingExplorer && !metadata ? (
        <div className="flex items-center justify-center gap-3 border border-border bg-card p-8 text-sm text-muted-foreground">
          <LoadingSpinner className="" />
          <span>
            {loadingSchemas
              ? "Loading database schemas..."
              : loadingTables
                ? "Loading database tables..."
                : "Loading table rows..."}
          </span>
        </div>
      ) : metadata ? (
        <div
          className={`border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-full ${
            focused ? "border-l-0" : ""
          }`}
        >
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
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setColumnsOpen(true)}
                title="Column types"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
              {totalRows > 40 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onToggleFocus}
                  title={focused ? "Collapse explorer" : "Expand explorer"}
                >
                  {focused ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              {canWrite && (
                <Button
                  variant="outline"
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

          {metadata.columns.length > 0 && (
            <div className="grid grid-cols-[minmax(180px,260px)_120px_minmax(220px,1fr)_36px] border-b border-border bg-card">
              <Select value={searchColumn} onValueChange={setSearchColumn}>
                <SelectTrigger className="h-9 rounded-none border-0 border-r border-border bg-background text-xs shadow-none focus:ring-1 focus:ring-inset">
                  <SelectValue placeholder="Column" />
                </SelectTrigger>
                <SelectContent className="bg-background text-foreground">
                  {metadata.columns.map((column) => (
                    <SelectItem key={column.name} value={column.name}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={searchOperation}
                onValueChange={(value) => setSearchOperation(value as PostgresSearchOperation)}
              >
                <SelectTrigger className="h-9 rounded-none border-0 border-r border-border bg-background font-mono text-xs shadow-none focus:ring-1 focus:ring-inset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background text-foreground">
                  {POSTGRES_SEARCH_OPERATIONS.map((operation) => (
                    <SelectItem key={operation.value} value={operation.value}>
                      {operation.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={searchInput}
                onChange={(event) => updateSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applySearch();
                }}
                className="h-9 rounded-none border-0 border-r border-border bg-background font-mono text-xs shadow-none focus-visible:ring-1 focus-visible:ring-inset"
                placeholder="Search value"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none bg-background"
                onClick={applySearch}
                title="Search"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div ref={explorerScrollRef} className="dashboard-scrollbar overflow-auto flex-1 min-h-0">
            {metadata.columns.length > 0 && (
              <div
                className="grid border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card z-10"
                style={{ gridTemplateColumns, width: gridWidth }}
              >
                {metadata.columns.map((column) => (
                  <div key={column.name} className="border-r border-border last:border-r-0">
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                      onClick={() => toggleSort(column.name)}
                      title={`Sort by ${column.name}`}
                    >
                      <span className="min-w-0 truncate">{column.name}</span>
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
                    className={`absolute left-0 grid ${isLastLoadedRow ? "" : "border-b border-border"}`}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns,
                      width: gridWidth,
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
                              onChange={(event) => updateDraftRow(row, column, event.target.value)}
                              className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                            />
                          </div>
                        );
                      }

                      const value = stringifyCell(draft[column.name]);
                      return (
                        <div
                          key={column.name}
                          className="min-w-0 border-r border-border last:border-r-0"
                        >
                          <div
                            className="min-h-9 min-w-0 overflow-hidden truncate whitespace-nowrap px-3 py-2 font-mono text-xs"
                            title={value || "NULL"}
                          >
                            {value || <span className="text-muted-foreground">NULL</span>}
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
                  style={{ gridTemplateColumns, width: gridWidth }}
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
                            onChange={(event) => updateNewRow(rowIndex, column, event.target.value)}
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

      <PostgresColumnSchemaDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        metadata={metadata}
        canChangeColumnTypes={canChangeColumnTypes}
        currentTableType={currentTableType}
        columnTypeDrafts={columnTypeDrafts}
        setColumnTypeDrafts={setColumnTypeDrafts}
        newColumnDrafts={newColumnDrafts}
        setNewColumnDrafts={setNewColumnDrafts}
        deletedColumnNames={deletedColumnNames}
        setDeletedColumnNames={setDeletedColumnNames}
        invalidNewColumnIds={invalidNewColumnIds}
        changingColumn={changingColumn}
        schemaChangeCount={schemaChangeCount}
        canSaveColumnSchemaChanges={canSaveColumnSchemaChanges}
        onReset={resetColumnSchemaDrafts}
        onSave={() => void saveColumnSchemaChanges()}
      />
    </div>
  );
}
