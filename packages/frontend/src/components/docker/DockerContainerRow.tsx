import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, GitBranch, MoreVertical, Play, RefreshCw, Square } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TruncateStart } from "@/components/ui/truncate-start";
import { formatCreated } from "@/lib/utils";
import { containerDisplayName, STATUS_BADGE } from "@/pages/docker-detail/helpers";
import type { DockerContainer } from "@/types";

export interface DockerContainerRowData extends DockerContainer {
  _nodeId: string;
  _nodeName?: string;
}

export interface DockerContainerRowProps {
  container: DockerContainerRowData;
  depth?: number;
  canView: boolean;
  canManage: boolean;
  canReorganize: boolean;
  showNode: boolean;
  loadingAction?: string;
  onStart: (container: DockerContainerRowData) => void;
  onStop: (container: DockerContainerRowData) => void;
  onRestart: (container: DockerContainerRowData) => void;
  onMoveToFolder: (container: DockerContainerRowData) => void;
  isOverlay?: boolean;
}

export function DockerContainerRow({
  container,
  depth = 0,
  canView,
  canManage,
  canReorganize,
  showNode,
  loadingAction,
  onStart,
  onStop,
  onRestart,
  onMoveToFolder,
  isOverlay,
}: DockerContainerRowProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: `${container._nodeId}:${container.name}`,
    data: { type: "container", container },
    disabled: isOverlay || !canReorganize || container.folderIsSystem,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : "none",
    opacity: isDragging ? 0.3 : 1,
  };

  const handleRowClick = () => {
    if (!isDragging && canView) {
      if (container.kind === "deployment") {
        navigate(
          `/docker/deployments/${container._nodeId}/${container.deploymentId ?? container.id}`
        );
        return;
      }
      navigate(`/docker/containers/${container._nodeId}/${container.id}`);
    }
  };

  return (
    <tr
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      className={`transition-colors border-b border-border select-none ${
        isOverlay
          ? "bg-card shadow-lg border border-border"
          : canView
            ? "cursor-pointer hover:bg-accent"
            : "cursor-default opacity-80"
      }`}
      onClick={handleRowClick}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
    >
      <td className="p-3" style={{ paddingLeft: `${depth * 24 + 12}px` }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            {container.kind === "deployment" ? (
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Box className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <TruncateStart
                text={containerDisplayName(container.name)}
                className="text-sm font-medium"
              />
              {container.kind === "deployment" && (
                <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                  Deployment
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {container.kind === "deployment"
                ? `active ${container.activeSlot ?? "-"}`
                : container.id.slice(0, 12)}
            </p>
          </div>
        </div>
      </td>
      <td className="p-3 text-sm text-muted-foreground">
        <TruncateStart text={container.image} className="text-muted-foreground" />
      </td>
      {showNode && (
        <td className="p-3">
          <Badge variant="secondary" className="text-xs">
            {container._nodeName || "-"}
          </Badge>
        </td>
      )}
      <td className="p-3">
        <Badge
          variant={STATUS_BADGE[(container as any)._transition ?? container.state] ?? "secondary"}
          className="text-xs"
        >
          {(container as any)._transition ?? container.state}
        </Badge>
      </td>
      <td className="p-3">
        <Badge
          variant={
            STATUS_BADGE[
              container.healthCheckEnabled ? (container.healthStatus ?? "unknown") : "disabled"
            ] ?? "secondary"
          }
          className="text-xs"
        >
          {container.healthCheckEnabled ? (container.healthStatus ?? "unknown") : "disabled"}
        </Badge>
      </td>
      <td className="p-3 pr-4 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
        {formatCreated(container.created)}
      </td>
      {(canManage || canReorganize) && (
        <td className="p-3 pl-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            {container.state === "running" ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!!loadingAction || !!(container as any)._transition}
                  onClick={() => onStop(container)}
                  title="Stop"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!!loadingAction || !!(container as any)._transition}
                  onClick={() => onRestart(container)}
                  title="Restart"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!!loadingAction || !!(container as any)._transition}
                onClick={() => onStart(container)}
                title="Start"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}

            {!container.folderIsSystem && canReorganize && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        container.kind === "deployment"
                          ? `/docker/deployments/${container._nodeId}/${container.deploymentId ?? container.id}`
                          : `/docker/containers/${container._nodeId}/${container.id}`
                      )
                    }
                  >
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onMoveToFolder(container)}>
                    Move to folder...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
