import { Link } from "react-router-dom";
import type { CA } from "@/types";

interface CertificateAuthoritiesCardProps {
  cas: CA[] | null;
  hasScope: (scope: string) => boolean;
}

export function CertificateAuthoritiesCard({ cas, hasScope }: CertificateAuthoritiesCardProps) {
  if (!hasScope("pki:ca:list:root")) return null;

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold">Certificate Authorities</h2>
        <Link to="/cas" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {(cas || []).length > 0 ? (
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
          {(cas || [])
            .filter((ca) => ca.status === "active")
            .slice(0, 6)
            .map((ca) => (
              <Link
                key={ca.id}
                to={`/cas/${ca.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm font-medium truncate flex-1">{ca.commonName}</span>
                <span className="text-xs text-muted-foreground">
                  {ca.type === "root" ? "Root" : "Intermediate"}
                </span>
                <span className="text-xs text-muted-foreground">{ca.keyAlgorithm}</span>
                <span className="text-xs text-muted-foreground">{ca.certCount || 0} certs</span>
              </Link>
            ))}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No certificate authorities configured.{" "}
          {hasScope("pki:ca:create:root") && (
            <Link to="/cas" className="text-foreground hover:underline">
              Create one
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
