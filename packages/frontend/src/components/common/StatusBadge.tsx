import { Badge, type BadgeProps } from "@/components/ui/badge";

export function StatusBadge({ status, size }: { status: string; size?: BadgeProps["size"] }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" size={size}>
          Active
        </Badge>
      );
    case "revoked":
      return (
        <Badge variant="destructive" size={size}>
          Revoked
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="warning" size={size}>
          Expired
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" size={size}>
          {status}
        </Badge>
      );
  }
}
