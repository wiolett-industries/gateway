import { Plus, Shield, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { CATree } from "@/components/ca/CATree";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { formatDate, daysUntil } from "@/lib/utils";

export function CAs() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const rootCAs = (cas || []).filter((ca) => !ca.parentId);
  const activeCAs = (cas || []).filter((ca) => ca.status === "active");
  const totalCerts = (cas || []).reduce((sum, ca) => sum + (ca.certCount || 0), 0);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Certificate Authorities</h1>
          <p className="text-sm text-muted-foreground">
            {activeCAs.length} active CA{activeCAs.length !== 1 ? "s" : ""} &middot; {totalCerts} certificate{totalCerts !== 1 ? "s" : ""} issued
          </p>
        </div>
        {hasRole("admin") && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Root CA
          </Button>
        )}
      </div>

      {/* CA Hierarchy Tree */}
      {(cas || []).length > 0 ? (
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Hierarchy</h2>
          </div>
          <div className="p-4">
            <CATree cas={cas} onSelect={(id) => navigate(`/cas/${id}`)} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-16 border border-border bg-card">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No Certificate Authorities</p>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Create a Root CA to start building your PKI infrastructure.
            You can then create Intermediate CAs and issue certificates.
          </p>
          {hasRole("admin") && (
            <Button onClick={() => setCreateDialogOpen(true)} className="mt-2">
              <Plus className="h-4 w-4" />
              Create Root CA
            </Button>
          )}
        </div>
      )}

      {/* Root CAs Table */}
      {rootCAs.length > 0 && (
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Root CAs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">Common Name</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Algorithm</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Intermediates</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Certificates</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Expires</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rootCAs.map((ca) => {
                  const childCount = (cas || []).filter((c) => c.parentId === ca.id).length;
                  const expDays = daysUntil(ca.notAfter);
                  return (
                    <tr
                      key={ca.id}
                      className="hover:bg-accent transition-colors cursor-pointer"
                      onClick={() => navigate(`/cas/${ca.id}`)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                          <span className="text-sm font-medium">{ca.commonName}</span>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">{ca.keyAlgorithm}</td>
                      <td className="p-3 text-sm text-muted-foreground">{childCount}</td>
                      <td className="p-3 text-sm text-muted-foreground">{ca.certCount}</td>
                      <td className="p-3">
                        <span className={`text-sm ${expDays <= 90 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
                          {formatDate(ca.notAfter)}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge className={ca.status === "active" ? "bg-green-600 text-white" : ""}
                          variant={ca.status !== "active" ? "destructive" : undefined}>
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
      )}

      <CACreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
    </PageTransition>
  );
}
