import {
  ArrowLeft,
  EllipsisVertical,
  KeyRound,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DatabaseConnection } from "@/types";
import { formatHealthStatusLabel, HEALTH_BADGE } from "./shared";

interface DatabaseHeaderProps {
  database: DatabaseConnection;
  healthStatus: DatabaseConnection["healthStatus"];
  canEdit: boolean;
  canReveal: boolean;
  canDelete: boolean;
  onBack: () => void;
  onTest: () => void;
  onOpenSettings: () => void;
  onRevealCredentials: () => void;
  onRemove: () => void;
}

export function DatabaseHeader({
  database,
  healthStatus,
  canEdit,
  canReveal,
  canDelete,
  onBack,
  onTest,
  onOpenSettings,
  onRevealCredentials,
  onRemove,
}: DatabaseHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{database.name}</h1>
            <Badge variant={HEALTH_BADGE[healthStatus] ?? "secondary"}>
              {formatHealthStatusLabel(healthStatus)}
            </Badge>
            <Badge variant="secondary">{database.type}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {database.host}:{database.port}
            {database.databaseName ? ` · ${database.databaseName}` : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canEdit && (
          <Button variant="outline" onClick={onTest}>
            <RefreshCw className="h-4 w-4" />
            Test
          </Button>
        )}
        {(canEdit || canReveal || canDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onClick={onOpenSettings}>
                  <Settings className="h-3.5 w-3.5 mr-2" />
                  Settings
                </DropdownMenuItem>
              )}
              {canEdit && (canReveal || canDelete) && <DropdownMenuSeparator />}
              {canReveal && (
                <DropdownMenuItem onClick={onRevealCredentials}>
                  <KeyRound className="h-3.5 w-3.5 mr-2" />
                  Reveal credentials
                </DropdownMenuItem>
              )}
              {canReveal && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem onClick={onRemove} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
