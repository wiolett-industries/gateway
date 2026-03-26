import type { DnsStatus } from "@/types";

const statusConfig: Record<DnsStatus, { color: string; label: string }> = {
  valid: { color: "bg-green-500", label: "Valid" },
  invalid: { color: "bg-red-500", label: "Invalid" },
  pending: { color: "bg-yellow-500", label: "Pending" },
  unknown: { color: "bg-gray-400", label: "Unknown" },
};

export function DnsStatusBadge({ status }: { status: DnsStatus }) {
  const { color, label } = statusConfig[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
