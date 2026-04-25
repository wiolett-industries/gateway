import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/services/api";
import type { DatabaseConnection } from "@/types";
import { stringifyCell, VIRTUAL_RESULT_ROW_HEIGHT } from "./shared";

export function DatabaseConsoleTab({ database }: { database: DatabaseConnection }) {
  const [input, setInput] = useState(database.type === "postgres" ? "select 1" : "PING");
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const resultScrollRef = useRef<HTMLDivElement>(null);

  const execute = async () => {
    setRunning(true);
    try {
      const data =
        database.type === "postgres"
          ? await api.executePostgresSql(database.id, input)
          : await api.executeRedisCommand(database.id, input);
      setResult(data);
      setResultOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Query failed");
    } finally {
      setRunning(false);
    }
  };

  const postgresResults =
    database.type === "postgres" &&
    result &&
    typeof result === "object" &&
    "results" in result &&
    Array.isArray((result as { results: unknown[] }).results)
      ? (
          result as {
            results: Array<{
              command: string;
              rowCount: number;
              fields: string[];
              rows: Record<string, unknown>[];
            }>;
          }
        ).results
      : null;

  const tableResult =
    database.type === "postgres" &&
    postgresResults &&
    postgresResults.length === 1 &&
    postgresResults[0] &&
    Array.isArray(postgresResults[0].fields)
      ? postgresResults[0]
      : null;

  const redisResults =
    database.type === "redis" &&
    result &&
    typeof result === "object" &&
    "results" in result &&
    Array.isArray((result as { results: unknown[] }).results)
      ? (result as { results: Array<{ command: string; result: unknown }> }).results
      : null;

  const resultRowVirtualizer = useVirtualizer({
    count: tableResult?.rows.length ?? 0,
    getScrollElement: () => resultScrollRef.current,
    estimateSize: () => VIRTUAL_RESULT_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => {
      if (!tableResult) return index;
      return `${index}-${JSON.stringify(tableResult.rows[index] ?? null)}`;
    },
  });

  const resultVirtualRows = tableResult ? resultRowVirtualizer.getVirtualItems() : [];
  const resultTopPadding = resultVirtualRows[0]?.start ?? 0;
  const resultBottomPadding = tableResult
    ? Math.max(
        0,
        resultRowVirtualizer.getTotalSize() -
          (resultVirtualRows[resultVirtualRows.length - 1]?.end ?? 0)
      )
    : 0;

  useEffect(() => {
    if (!resultOpen || !tableResult) return;
    const frame = requestAnimationFrame(() => {
      resultRowVirtualizer.measure();
      resultRowVirtualizer.scrollToOffset(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultOpen, resultRowVirtualizer, tableResult]);

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <div className="border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3 bg-card border-b border-border shrink-0">
            <div>
              <h3 className="text-sm font-semibold">
                {database.type === "postgres" ? "SQL Console" : "Redis Command Console"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Run one or more {database.type === "postgres" ? "SQL statements" : "Redis commands"}
                .
              </p>
            </div>
            <Button size="sm" onClick={() => void execute()} disabled={running}>
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </div>
          <CodeEditor
            value={input}
            onChange={setInput}
            language={database.type === "postgres" ? "sql" : "plain"}
            minHeight="0px"
            className="border-0 flex-1 min-h-0"
          />
        </div>
      </div>

      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent
          className={`w-[90vw] max-h-[85vh] flex flex-col overflow-hidden ${
            database.type === "postgres" ? "sm:max-w-[64rem]" : "sm:max-w-2xl"
          }`}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {database.type === "postgres" ? "Query Result" : "Command Result"}
            </DialogTitle>
          </DialogHeader>
          {tableResult ? (
            <div
              ref={resultScrollRef}
              className="flex-1 min-h-0 overflow-auto border border-border bg-card"
            >
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    {tableResult.fields.map((field) => (
                      <th
                        key={field}
                        className="px-4 py-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase whitespace-nowrap"
                      >
                        {field}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultTopPadding > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={tableResult.fields.length}
                        style={{ height: resultTopPadding, padding: 0 }}
                      />
                    </tr>
                  )}
                  {resultVirtualRows.map((virtualRow) => {
                    const row = tableResult.rows[virtualRow.index];
                    return (
                      <tr
                        key={`${virtualRow.index}-${JSON.stringify(row)}`}
                        className="border-b border-border last:border-b-0"
                      >
                        {tableResult.fields.map((field) => (
                          <td
                            key={field}
                            className="px-4 py-3 font-mono whitespace-nowrap align-top"
                          >
                            {stringifyCell(row?.[field])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {resultBottomPadding > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={tableResult.fields.length}
                        style={{ height: resultBottomPadding, padding: 0 }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : postgresResults ? (
            <div className="flex-1 min-h-0 overflow-auto space-y-4">
              {postgresResults.map((entry, index) => (
                <div
                  key={`${entry.command}-${index}`}
                  className="border border-border bg-card overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
                    <div>
                      <h4 className="text-sm font-semibold">Statement {index + 1}</h4>
                      <p className="text-xs text-muted-foreground">
                        {entry.command} · {entry.rowCount} row{entry.rowCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  {entry.fields.length > 0 ? (
                    <div className="overflow-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-card">
                          <tr className="border-b border-border">
                            {entry.fields.map((field) => (
                              <th
                                key={field}
                                className="px-4 py-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase whitespace-nowrap"
                              >
                                {field}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-b border-border last:border-b-0">
                              {entry.fields.map((field) => (
                                <td
                                  key={field}
                                  className="px-4 py-3 font-mono whitespace-nowrap align-top"
                                >
                                  {stringifyCell(row?.[field])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">Command completed.</div>
                  )}
                </div>
              ))}
            </div>
          ) : redisResults ? (
            <div className="flex-1 min-h-0 overflow-auto space-y-4">
              {redisResults.map((entry, index) => (
                <div
                  key={`${entry.command}-${index}`}
                  className="border border-border bg-card overflow-hidden"
                >
                  <div className="border-b border-border px-4 py-3">
                    <h4 className="text-sm font-semibold">Command {index + 1}</h4>
                    <p className="text-xs text-muted-foreground">{entry.command}</p>
                  </div>
                  <pre className="overflow-auto p-4 text-sm whitespace-pre-wrap">
                    {JSON.stringify(entry.result, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-border bg-card overflow-hidden flex-1 min-h-0">
              <pre className="overflow-auto p-4 text-sm whitespace-pre-wrap h-full">
                {result ? JSON.stringify(result, null, 2) : "No results yet."}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
