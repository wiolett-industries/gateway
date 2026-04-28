import type { BadgeProps } from "@/components/ui/badge";
import type { LoggingSeverity } from "@/types";

export function loggingSeverityBadgeVariant(severity: LoggingSeverity): BadgeProps["variant"] {
  if (severity === "trace") return "outline";
  if (severity === "debug") return "info";
  if (severity === "info") return "success";
  if (severity === "warn") return "warning";
  return "destructive";
}
