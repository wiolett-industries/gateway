import { CornerDownRight, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { CA } from "@/types";
import { formatDate, daysUntil } from "@/lib/utils";

export function CAs() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createIntermediateParentId, setCreateIntermediateParentId] = useState<string | undefined>();

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const allCAs = cas || [];
  const rootCAs = allCAs.filter((ca) => !ca.parentId);
  const activeCAs = allCAs.filter((ca) => ca.status === "active");
  const totalCerts = allCAs.reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  const getChildren = (parentId: string) => allCAs.filter((ca) => ca.parentId === parentId);

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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setCreateIntermediateParentId("pick"); setCreateDialogOpen(true); }} disabled={allCAs.length === 0}>
              <Plus className="h-4 w-4" />
              Create Intermediate
            </Button>
            <Button onClick={() => { setCreateIntermediateParentId(undefined); setCreateDialogOpen(true); }}>
              <Plus className="h-4 w-4" />
              Create Root CA
            </Button>
          </div>
        )}
      </div>

      {allCAs.length > 0 ? (
        <div className="border border-border bg-card">
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
                {rootCAs.map((rootCA) => {
                  const children = getChildren(rootCA.id);
                  return (
                    <CARows
                      key={rootCA.id}
                      ca={rootCA}
                      children={children}
                      allCAs={allCAs}
                      depth={0}
                      onSelect={(id) => navigate(`/cas/${id}`)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
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

      <CACreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        parentId={createIntermediateParentId}
      />
    </div>
    </PageTransition>
  );
}

function CARows({ ca, children, allCAs, depth, onSelect }: {
  ca: CA;
  children: CA[];
  allCAs: CA[];
  depth: number;
  onSelect: (id: string) => void;
}) {
  const expDays = daysUntil(ca.notAfter);
  const grandchildren = (parentId: string) => allCAs.filter((c) => c.parentId === parentId);

  return (
    <>
      <tr
        className="hover:bg-accent transition-colors cursor-pointer"
        onClick={() => onSelect(ca.id)}
      >
        <td className="p-3">
          <div className="flex items-center gap-1.5">
            {depth > 0 && <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0 mx-2" />}
            <span className="text-sm font-medium">{ca.commonName}</span>
          </div>
        </td>
        <td className="p-3 text-sm text-muted-foreground">{ca.keyAlgorithm}</td>
        <td className="p-3 text-sm text-muted-foreground">{ca.certCount}</td>
        <td className="p-3">
          <span className={`text-sm ${expDays <= 90 && expDays > 0 ? "text-amber-600 dark:text-amber-400" : expDays <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {formatDate(ca.notAfter)}
          </span>
        </td>
        <td className="p-3"><StatusBadge status={ca.status} /></td>
      </tr>
      {children.map((child) => (
        <CARows
          key={child.id}
          ca={child}
          children={grandchildren(child.id)}
          allCAs={allCAs}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
