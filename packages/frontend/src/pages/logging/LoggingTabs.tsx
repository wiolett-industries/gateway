import { EllipsisVertical, FileJson, ScrollText, Settings, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { LoggingEnvironment, LoggingSchema } from "@/types";

export function LoggingEnvironmentsTab({
  environments,
  search,
  loading,
  canCreate,
  onSearchChange,
  onCreate,
  onOpen,
}: {
  environments: LoggingEnvironment[];
  search: string;
  loading: boolean;
  canCreate: boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (environment: LoggingEnvironment) => void;
}) {
  return (
    <div className="space-y-4">
      <SearchFilterBar
        placeholder="Search environments..."
        search={search}
        onSearchChange={onSearchChange}
        hasActiveFilters={search !== ""}
        onReset={() => onSearchChange("")}
      />

      {loading ? (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          Loading logging environments...
        </div>
      ) : environments.length === 0 ? (
        <EmptyState
          message="No logging environments. Create an environment to receive logs from an external service."
          {...(canCreate ? { actionLabel: "Create Environment", onAction: onCreate } : {})}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg bg-card md:overflow-x-visible">
          <div className="min-w-[920px] divide-y divide-border -mb-px md:min-w-0 [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {environments.map((environment) => (
              <div
                key={environment.id}
                className="flex items-center gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50"
                onClick={() => onOpen(environment)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ScrollText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-[320px] flex-1 md:min-w-0">
                  <p className="truncate text-sm font-medium">{environment.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {environment.slug}
                    {environment.description ? ` · ${environment.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {environment.schemaName ?? "No schema"}
                  </Badge>
                  <Badge variant="secondary" className="uppercase shrink-0">
                    {environment.schemaMode}
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {environment.retentionDays}d
                  </Badge>
                  <Badge
                    variant={environment.enabled ? "success" : "secondary"}
                    className="uppercase shrink-0"
                  >
                    {environment.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function LoggingSchemasTab({
  schemas,
  search,
  loading,
  canCreate,
  canEdit,
  canDelete,
  canOpen,
  onSearchChange,
  onCreate,
  onOpen,
  onDelete,
}: {
  schemas: LoggingSchema[];
  search: string;
  loading: boolean;
  canCreate: boolean;
  canEdit: (schema: LoggingSchema) => boolean;
  canDelete: (schema: LoggingSchema) => boolean;
  canOpen: (schema: LoggingSchema) => boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (schema: LoggingSchema) => void;
  onDelete: (schema: LoggingSchema) => Promise<boolean>;
}) {
  return (
    <div className="space-y-4">
      <SearchFilterBar
        placeholder="Search schemas..."
        search={search}
        onSearchChange={onSearchChange}
        hasActiveFilters={search !== ""}
        onReset={() => onSearchChange("")}
      />

      {loading ? (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          Loading logging schemas...
        </div>
      ) : schemas.length === 0 ? (
        <EmptyState
          message="No logging schemas. Create a reusable schema and attach it to environments."
          {...(canCreate ? { actionLabel: "Create Schema", onAction: onCreate } : {})}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg bg-card md:overflow-x-visible">
          <div className="min-w-[920px] divide-y divide-border -mb-px md:min-w-0 [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {schemas.map((schema) => (
              <div
                key={schema.id}
                className={cn(
                  "flex items-center gap-4 p-4 transition-colors",
                  canOpen(schema) && "cursor-pointer hover:bg-muted/50"
                )}
                onClick={canOpen(schema) ? () => onOpen(schema) : undefined}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FileJson className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-[320px] flex-1 md:min-w-0">
                  <p className="truncate text-sm font-medium">{schema.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {schema.slug}
                    {schema.description ? ` · ${schema.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="uppercase shrink-0">
                    {schema.schemaMode}
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {schema.fieldSchema.length} fields
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {new Date(schema.updatedAt).toLocaleDateString()}
                  </Badge>
                  {(canEdit(schema) || canDelete(schema)) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <EllipsisVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit(schema) && (
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(schema);
                            }}
                          >
                            <Settings className="h-3.5 w-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canEdit(schema) && canDelete(schema) && <DropdownMenuSeparator />}
                        {canDelete(schema) && (
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              void onDelete(schema);
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
