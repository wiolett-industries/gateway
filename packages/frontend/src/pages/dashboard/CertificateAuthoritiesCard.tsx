import { Link } from "react-router-dom";
import { PanelShell } from "@/components/common/PanelShell";
import type { CA } from "@/types";

interface CertificateAuthoritiesCardProps {
  cas: CA[] | null;
  hasScope: (scope: string) => boolean;
}

export function CertificateAuthoritiesCard({ cas, hasScope }: CertificateAuthoritiesCardProps) {
  if (!hasScope("pki:ca:view:root") && !hasScope("pki:ca:view:intermediate")) return null;

  const visibleCas = (cas || []).filter((ca) => ca.status === "active").slice(0, 6);
  if (visibleCas.length === 0) return null;

  return (
    <PanelShell
      title="Certificate Authorities"
      actions={
        <Link to="/cas" className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      }
    >
      <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
        {visibleCas.map((ca) => (
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
    </PanelShell>
  );
}
