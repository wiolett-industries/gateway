import { Plus, Shield, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { CA } from "@/types";
import { formatDate, daysUntil } from "@/lib/utils";

function CATable({ title, cas, allCAs, onSelect }: {
  title: string;
  cas: CA[];
  allCAs: CA[];
  onSelect: (id: string) => void;
}) {
  if (cas.length === 0) return null;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <span className="text-xs text-muted-foreground">{cas.length}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="p-3 text-xs font-medium text-muted-foreground">Common Name</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Algorithm</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Certificates</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Expires</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cas.map((ca) => {
              const expDays = daysUntil(ca.notAfter);
              const parentCA = ca.parentId ? allCAs.find((c) => c.id === ca.parentId) : null;
              return (
                <tr
                  key={ca.id}
                  className="hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => onSelect(ca.id)}
                >
                  <td className="p-3">
                    <div>
                      <p className="text-sm font-medium">{ca.commonName}</p>
                      {parentCA && (
                        <p className="text-xs text-muted-foreground">signed by {parentCA.commonName}</p>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">{ca.keyAlgorithm}</td>
                  <td className="p-3 text-sm text-muted-foreground">{ca.certCount}</td>
                  <td className="p-3">
                    <span className={`text-sm ${expDays <= 90 && expDays > 0 ? "text-yellow-600 dark:text-yellow-400" : expDays <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {formatDate(ca.notAfter)}
                    </span>
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={ca.status === "active" ? "outline" : ca.status === "revoked" ? "destructive" : "secondary"}
                      className={ca.status === "active" ? "border-green-600/50 text-green-700 dark:text-green-400" : ""}
                    >
                      {ca.status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CAs() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const allCAs = cas || [];
  const rootCAs = allCAs.filter((ca) => !ca.parentId);
  const intermediateCAs = allCAs.filter((ca) => !!ca.parentId);
  const activeCAs = allCAs.filter((ca) => ca.status === "active");
  const totalCerts = allCAs.reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Certificate Authorities</h1>
          <p className="text-sm text-muted-foreground">
            {activeCAs.length} active &middot; {totalCerts} certificate{totalCerts !== 1 ? "s" : ""} issued
          </p>
        </div>
        {hasRole("admin") && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Root CA
          </Button>
        )}
      </div>

      {allCAs.length > 0 ? (
        <>
          <CATable title="Root CAs" cas={rootCAs} allCAs={allCAs} onSelect={(id) => navigate(`/cas/${id}`)} />
          <CATable title="Intermediate CAs" cas={intermediateCAs} allCAs={allCAs} onSelect={(id) => navigate(`/cas/${id}`)} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-16 border border-border bg-card">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No Certificate Authorities</p>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Create a Root CA to start building your PKI infrastructure.
          </p>
          {hasRole("admin") && (
            <Button onClick={() => setCreateDialogOpen(true)} className="mt-2">
              <Plus className="h-4 w-4" />
              Create Root CA
            </Button>
          )}
        </div>
      )}

      <CACreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
    </PageTransition>
  );
}
