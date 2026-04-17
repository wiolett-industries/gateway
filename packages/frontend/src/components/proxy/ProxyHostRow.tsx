import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreVertical } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/stores/auth";
import type { ProxyHost, ProxyHostType } from "@/types";

function TypeBadge({ type }: { type: ProxyHostType }) {
  switch (type) {
    case "proxy":
      return <Badge variant="secondary">PROXY</Badge>;
    case "redirect":
      return <Badge variant="warning">REDIRECT</Badge>;
    case "404":
      return <Badge variant="destructive">404</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
}

export interface ProxyHostRowProps {
  host: ProxyHost;
  depth?: number;
  onToggle: (id: string, currentEnabled: boolean) => void;
  togglingIds: Set<string>;
  onMoveToFolder: (hostId: string) => void;
  isOverlay?: boolean;
}

export function ProxyHostRow({
  host,
  depth = 0,
  onToggle,
  togglingIds,
  onMoveToFolder,
  isOverlay,
}: ProxyHostRowProps) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const canViewHost = hasScope("proxy:view") || hasScope(`proxy:view:${host.id}`);
  const canEditHost = hasScope("proxy:edit") || hasScope(`proxy:edit:${host.id}`);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: host.id,
    data: { type: "host", host },
    disabled: isOverlay,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const handleRowClick = () => {
    if (!isDragging && canViewHost) navigate(`/proxy-hosts/${host.id}`);
  };

  return (
    <tr
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      className={`transition-colors border-b border-border select-none ${
        isOverlay
          ? "bg-card shadow-lg border border-border"
          : canViewHost
            ? "cursor-pointer hover:bg-accent"
            : "cursor-default opacity-80"
      }`}
      onClick={handleRowClick}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
    >
      <td className="p-3" style={{ paddingLeft: `${depth * 24 + 12}px` }}>
        <div>
          <p className="text-sm font-medium">{host.domainNames[0]}</p>
          {host.domainNames.length > 1 && (
            <p className="text-xs text-muted-foreground">+{host.domainNames.length - 1} more</p>
          )}
        </div>
      </td>
      <td className="p-3 text-sm text-muted-foreground">
        {host.type === "proxy" && host.forwardHost
          ? `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`
          : host.type === "redirect" && host.redirectUrl
            ? host.redirectUrl
            : "—"}
      </td>
      <td className="p-3">
        <TypeBadge type={host.type} />
      </td>
      <td className="p-3">
        {host.sslEnabled ? (
          <Badge variant="success">SSL</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3">
        <Badge
          variant={
            (
              {
                online: "success",
                recovering: "warning",
                offline: "destructive",
                degraded: "destructive",
                unknown: "secondary",
                disabled: "secondary",
              } as Record<string, "success" | "warning" | "destructive" | "secondary">
            )[host.effectiveHealthStatus || host.healthStatus] || "secondary"
          }
          className="text-xs"
        >
          {(
            {
              online: "Healthy",
              recovering: "Recovering",
              offline: "Offline",
              degraded: "Degraded",
              unknown: "Unknown",
              disabled: "Disabled",
            } as Record<string, string>
          )[host.effectiveHealthStatus || host.healthStatus] || host.healthStatus}
        </Badge>
      </td>
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        {host.isSystem ? (
          <span className="inline-flex h-5 w-9 items-center border border-border bg-primary opacity-50 cursor-not-allowed">
            <span className="inline-block h-4 w-4 bg-background translate-x-4" />
          </span>
        ) : (
          <div className={togglingIds.has(host.id) ? "opacity-50 pointer-events-none" : undefined}>
            <Switch
              checked={host.enabled}
              onChange={(v) => onToggle(host.id, !v)}
              disabled={!canEditHost}
            />
          </div>
        )}
      </td>
      {canEditHost && (
        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/proxy-hosts/${host.id}`)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onMoveToFolder(host.id)}>
                Move to folder...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      )}
    </tr>
  );
}
