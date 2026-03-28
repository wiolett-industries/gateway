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
import { HealthDot } from "@/components/ui/health-dot";
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
  const { hasRole } = useAuthStore();
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
    if (!isDragging) navigate(`/proxy-hosts/${host.id}`);
  };

  return (
    <tr
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      className={`hover:bg-accent transition-colors cursor-pointer border-b border-border last:border-b-0 select-none ${
        isOverlay ? "bg-card shadow-lg border border-border" : ""
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
        <HealthDot status={host.healthStatus} />
      </td>
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <div className={togglingIds.has(host.id) ? "opacity-50 pointer-events-none" : undefined}>
          <Switch checked={host.enabled} onChange={(v) => onToggle(host.id, !v)} />
        </div>
      </td>
      {hasRole("admin", "operator") && (
        <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
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
