import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, formatTimeLeft } from "@/lib/utils";

export interface ExpiringItem {
  id: string;
  name: string;
  type: "ca" | "pki" | "ssl";
  expiresAt: string;
  daysLeft: number;
}

interface CertificateExpiryCardProps {
  expiringItems: ExpiringItem[];
  hasScope: (scope: string) => boolean;
}

function filterByScope(items: ExpiringItem[], hasScope: (scope: string) => boolean) {
  return items.filter((i) =>
    i.type === "ssl"
      ? hasScope("ssl:cert:list")
      : i.type === "pki"
        ? hasScope("pki:cert:list")
        : hasScope("pki:ca:list:root")
  );
}

export function CertificateExpiryCard({ expiringItems, hasScope }: CertificateExpiryCardProps) {
  const visible = filterByScope(expiringItems, hasScope);
  if (visible.length === 0) return null;

  return (
    <div className="border bg-card" style={{ borderColor: "rgb(234 179 8 / 0.6)" }}>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <h2 className="font-semibold" style={{ color: "rgb(234 179 8)" }}>
          Expiring Soon
        </h2>
        <Badge
          variant="warning"
          className="ml-auto"
          style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
        >
          {visible.length}
        </Badge>
      </div>
      <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
        {[...visible]
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .map((item) => (
            <Link
              key={`${item.type}-${item.id}`}
              to={
                item.type === "ca"
                  ? `/cas/${item.id}`
                  : item.type === "pki"
                    ? `/certificates/${item.id}`
                    : "/ssl-certificates"
              }
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm font-medium truncate flex-1">{item.name}</span>
              <Badge variant="secondary" className="text-xs">
                {item.type === "ca" ? "CA" : item.type === "pki" ? "PKI" : "SSL"}
              </Badge>
              <span className="text-xs text-muted-foreground">{formatDate(item.expiresAt)}</span>
              <span
                className={cn(
                  "text-xs font-medium",
                  item.daysLeft <= 7
                    ? "text-amber-600 dark:text-amber-400 font-semibold"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                {formatTimeLeft(item.expiresAt)}
              </span>
            </Link>
          ))}
      </div>
    </div>
  );
}
