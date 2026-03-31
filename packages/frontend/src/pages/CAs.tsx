import { CornerDownRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daysUntil, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";
import type { CA } from "@/types";

type StatusFilter = "active" | "all";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active only" },
  { value: "all", label: "All statuses" },
];

export function CAs() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createIntermediateParentId, setCreateIntermediateParentId] = useState<
    string | undefined
  >();
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);

  useEffect(() => {
    if (modal?.type === "createCA") {
      setCreateIntermediateParentId(undefined);
      setCreateDialogOpen(true);
      closeModal();
    }
  }, [modal, closeModal]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const allCAs = cas || [];
  const filteredByStatus =
    statusFilter === "all" ? allCAs : allCAs.filter((ca) => ca.status === "active");
  const visibleCAs = search
    ? filteredByStatus.filter((ca) => ca.commonName.toLowerCase().includes(search.toLowerCase()))
    : filteredByStatus;
  const rootCAs = visibleCAs.filter((ca) => !ca.parentId);
  const activeCAs = allCAs.filter((ca) => ca.status === "active");
  const totalCerts = allCAs.reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  const getChildren = (parentId: string) => visibleCAs.filter((ca) => ca.parentId === parentId);

  const hasActiveFilters = statusFilter !== "active" || search !== "";

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("active");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Certificate Authorities</h1>
            <p className="text-sm text-muted-foreground">
              {activeCAs.length} active &middot; {totalCerts} certificate
              {totalCerts !== 1 ? "s" : ""} issued
            </p>
          </div>
          {hasScope("ca:create:root") && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreateIntermediateParentId("pick");
                  setCreateDialogOpen(true);
                }}
                disabled={allCAs.length === 0}
              >
                <Plus className="h-4 w-4" />
                Create Intermediate
              </Button>
              <Button
                onClick={() => {
                  setCreateIntermediateParentId(undefined);
                  setCreateDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Create Root CA
              </Button>
            </div>
          )}
        </div>

        {/* Search and filters */}
        <SearchFilterBar
          placeholder="Search by common name..."
          search={search}
          onSearchChange={setSearch}
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
          filters={
            <div className="w-40">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {/* Table */}
        {visibleCAs.length > 0 ? (
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
                        allCAs={visibleCAs}
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
          <EmptyState
            message="No certificate authorities."
            {...(hasScope("ca:create:root") ? { actionLabel: "Create one", onAction: () => {
              setCreateIntermediateParentId(undefined);
              setCreateDialogOpen(true);
            } } : {})}
            hasActiveFilters={hasActiveFilters}
            onReset={resetFilters}
          />
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

function CARows({
  ca,
  children,
  allCAs,
  depth,
  onSelect,
}: {
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
            {depth > 0 && (
              <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0 ml-0 mr-1" />
            )}
            <span className="text-sm font-medium">{ca.commonName}</span>
          </div>
        </td>
        <td className="p-3 text-sm text-muted-foreground">{ca.keyAlgorithm}</td>
        <td className="p-3 text-sm text-muted-foreground">{ca.certCount}</td>
        <td className="p-3">
          <span
            className={`text-sm ${expDays <= 90 && expDays > 0 ? "text-amber-600 dark:text-amber-400" : expDays <= 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formatDate(ca.notAfter)}
          </span>
        </td>
        <td className="p-3 align-middle">
          <StatusBadge status={ca.status} />
        </td>
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
