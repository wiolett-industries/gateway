import { Database as DatabaseIcon, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DatabaseConnection } from "@/types";
import {
  buildDatabasePayload,
  type DatabaseConnectionDraft,
  DatabaseConnectionForm,
  draftFromConnection,
} from "./database-detail/DatabaseConnectionForm";

const HEALTH_BADGE: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  online: "success",
  degraded: "warning",
  offline: "destructive",
  unknown: "secondary",
};

function formatLastCheck(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

function formatHealthLabel(status: DatabaseConnection["healthStatus"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function DatabaseTagSummary({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;

  const primaryTag = tags[0]!;
  const extraCount = tags.length - 1;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Badge
        variant="info"
        className="max-w-[180px] min-w-0 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs"
        title={primaryTag}
      >
        {primaryTag}
      </Badge>
      {extraCount > 0 && (
        <Badge variant="secondary" className="shrink-0">
          +{extraCount}
        </Badge>
      )}
    </div>
  );
}

export function Databases() {
  const navigate = useNavigate();
  const { hasScope, hasScopedAccess } = useAuthStore();
  const [rows, setRows] = useState<DatabaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "postgres" | "redis">("all");
  const [healthFilter, setHealthFilter] = useState<
    "all" | "online" | "offline" | "degraded" | "unknown"
  >("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<DatabaseConnectionDraft>(draftFromConnection(null));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listDatabases({
        limit: 200,
        search: search || undefined,
        type: typeFilter === "all" ? undefined : typeFilter,
        healthStatus: healthFilter === "all" ? undefined : healthFilter,
      });
      setRows(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load databases");
    } finally {
      setLoading(false);
    }
  }, [healthFilter, search, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = hasScope("databases:create");

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          hasScopedAccess("databases:list") &&
          (hasScope("databases:view") || hasScope(`databases:view:${row.id}`))
      ),
    [hasScope, hasScopedAccess, rows]
  );

  const save = async () => {
    setSaving(true);
    try {
      const created = await api.createDatabase(buildDatabasePayload(draft));
      toast.success("Database connection created");
      setCreateOpen(false);
      setDraft(draftFromConnection(null));
      navigate(`/databases/${created.id}/overview`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create database connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Databases</h1>
            <p className="text-sm text-muted-foreground">
              Saved Postgres and Redis connections managed through Gateway
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => void load()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Database
              </Button>
            )}
          </div>
        </div>

        <SearchFilterBar
          placeholder="Search databases..."
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={() => void load()}
          hasActiveFilters={search !== "" || typeFilter !== "all" || healthFilter !== "all"}
          onReset={() => {
            setSearch("");
            setTypeFilter("all");
            setHealthFilter("all");
          }}
          filters={
            <>
              <Select
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="postgres">Postgres</SelectItem>
                  <SelectItem value="redis">Redis</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={healthFilter}
                onValueChange={(value) => setHealthFilter(value as typeof healthFilter)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Health" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All health states</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="degraded">Degraded</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />

        {loading ? (
          <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
            Loading database connections...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            message="No databases. Add a Postgres or Redis connection to manage it through Gateway."
            {...(canCreate
              ? { actionLabel: "Add Database", onAction: () => setCreateOpen(true) }
              : {})}
          />
        ) : (
          <div className="border border-border rounded-lg bg-card">
            <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/databases/${row.id}/overview`)}
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted shrink-0">
                    <DatabaseIcon className="h-5 w-5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{row.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.host}:{row.port}
                      {row.databaseName ? ` · ${row.databaseName}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-xs uppercase shrink-0">
                      {row.type}
                    </Badge>
                    <DatabaseTagSummary tags={row.tags} />
                    <Badge variant="outline" className="text-xs shrink-0">
                      {formatLastCheck(row.lastHealthCheckAt)}
                    </Badge>
                    <Badge
                      variant={HEALTH_BADGE[row.healthStatus] ?? "secondary"}
                      className="text-xs shrink-0 uppercase"
                    >
                      {formatHealthLabel(row.healthStatus)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Database</DialogTitle>
          </DialogHeader>
          <DatabaseConnectionForm draft={draft} onChange={setDraft} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
