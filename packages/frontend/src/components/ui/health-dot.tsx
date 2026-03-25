import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/types";

const healthBadgeVariant: Record<
  HealthStatus,
  "success" | "destructive" | "warning" | "secondary"
> = {
  online: "success",
  offline: "destructive",
  degraded: "warning",
  unknown: "secondary",
};

const healthLabel: Record<HealthStatus, string> = {
  online: "Online",
  offline: "Offline",
  degraded: "Degraded",
  unknown: "Unknown",
};

export function HealthDot({ status }: { status: HealthStatus }) {
  return (
    <Badge variant={healthBadgeVariant[status] || "secondary"}>
      {healthLabel[status] || "Unknown"}
    </Badge>
  );
}
