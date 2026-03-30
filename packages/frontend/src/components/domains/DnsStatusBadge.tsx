import { Badge } from "@/components/ui/badge";
import type { DnsStatus } from "@/types";

const statusConfig: Record<
  DnsStatus,
  { variant: "success" | "destructive" | "warning" | "secondary"; label: string }
> = {
  valid: { variant: "success", label: "Valid" },
  invalid: { variant: "destructive", label: "Invalid" },
  pending: { variant: "warning", label: "Pending" },
  unknown: { variant: "secondary", label: "Unknown" },
};

export function DnsStatusBadge({ status }: { status: DnsStatus }) {
  const { variant, label } = statusConfig[status];
  return (
    <Badge variant={variant} className="text-xs">
      {label}
    </Badge>
  );
}
