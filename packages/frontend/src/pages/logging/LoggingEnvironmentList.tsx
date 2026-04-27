import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LoggingEnvironment } from "@/types";

export function LoggingEnvironmentList({
  environments,
  selectedId,
  search,
  canCreate,
  onSearchChange,
  onCreate,
  onSelect,
}: {
  environments: LoggingEnvironment[];
  selectedId: string | null;
  search: string;
  canCreate: boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onSelect: (environment: LoggingEnvironment) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div>
          <h2 className="text-sm font-semibold">Environments</h2>
          <p className="text-xs text-muted-foreground">{environments.length} configured</p>
        </div>
        {canCreate && (
          <Button size="icon" variant="outline" onClick={onCreate} title="Create environment">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="relative border-b border-border p-3">
        <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {environments.map((environment) => (
          <button
            key={environment.id}
            type="button"
            className={cn(
              "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted/60",
              selectedId === environment.id && "bg-muted"
            )}
            onClick={() => onSelect(environment)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{environment.name}</span>
                <Badge
                  variant={environment.enabled ? "success" : "secondary"}
                  className="text-[10px]"
                >
                  {environment.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{environment.slug}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
