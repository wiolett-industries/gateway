import { ChevronLeft, ChevronRight, MoreVertical, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { SSLCertificateCreateDialog } from "@/components/ssl/SSLCertificateCreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { cn, daysUntil, formatDate, hoursUntil } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useSSLStore } from "@/stores/ssl";
import { useUIStore } from "@/stores/ui";
import type { SSLCertStatus, SSLCertType } from "@/types";

const typeOptions: { value: SSLCertType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "acme", label: "ACME" },
  { value: "upload", label: "Upload" },
  { value: "internal", label: "Internal" },
];

const statusOptions: { value: SSLCertStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "pending", label: "Pending" },
  { value: "error", label: "Error" },
];

function SSLTypeBadge({ type }: { type: SSLCertType }) {
  switch (type) {
    case "acme":
      return <Badge variant="success">ACME</Badge>;
    case "upload":
      return <Badge variant="secondary">UPLOAD</Badge>;
    case "internal":
      return <Badge variant="default">INTERNAL</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
}

function SSLStatusBadge({ status }: { status: SSLCertStatus }) {
  switch (status) {
    case "active":
      return <Badge variant="success">Active</Badge>;
    case "expired":
      return <Badge variant="destructive">Expired</Badge>;
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function SSLCertificates() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { hasScope } = useAuthStore();
  const canViewSystemCertificates = useAuthStore((s) => s.hasScope("admin:details:certificates"));
  const showSystemCertificatePreference = useUIStore((s) => s.showSystemCertificates);
  const showSystemCertificates = canViewSystemCertificates && showSystemCertificatePreference;
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);

  // Open dialog from command palette
  useEffect(() => {
    if (modal?.type === "createSSLCert") {
      setCreateDialogOpen(true);
      closeModal();
    }
  }, [modal, closeModal]);
  const {
    certificates,
    isLoading,
    filters,
    page,
    totalPages,
    total,
    fetchCertificates,
    setFilters,
    setPage,
    resetFilters,
    renewCert,
    deleteCert,
  } = useSSLStore();
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    void showSystemCertificates;
    fetchCertificates();
  }, [fetchCertificates, showSystemCertificates]);

  useRealtime("ssl.cert.changed", () => {
    fetchCertificates();
  });

  const handleSearch = () => {
    setFilters({ search: searchInput });
  };

  const hasActiveFilters =
    filters.type !== "all" || filters.status !== "active" || filters.search !== "";

  const handleRenew = async (id: string) => {
    try {
      await renewCert(id);
      toast.success("Certificate renewal initiated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to renew certificate");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete SSL Certificate",
      description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await deleteCert(id);
      toast.success("Certificate deleted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete certificate";
      if (msg.includes("in use") || msg.includes("CERT_IN_USE")) {
        toast.error(
          "Cannot delete: certificate is used by proxy hosts. Remove it from proxy hosts first."
        );
      } else if (msg.includes("System") || msg.includes("SYSTEM_CERT")) {
        toast.error("System certificates cannot be deleted.");
      } else {
        toast.error(msg);
      }
    }
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">SSL Certificates</h1>
            <p className="text-sm text-muted-foreground">{total} certificates total</p>
          </div>
          {hasScope("ssl:cert:issue") && (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Certificate
            </Button>
          )}
        </div>

        {/* Search and filters */}
        <SearchFilterBar
          placeholder="Search by name or domain..."
          search={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearch}
          hasActiveFilters={hasActiveFilters}
          onReset={() => {
            resetFilters();
            setSearchInput("");
          }}
          filters={
            <>
              <div className="w-40">
                <Select
                  value={filters.type}
                  onValueChange={(v) => setFilters({ type: v as SSLCertType | "all" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <Select
                  value={filters.status}
                  onValueChange={(v) => setFilters({ status: v as SSLCertStatus | "all" })}
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
            </>
          }
        />

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <LoadingSpinner className="" />
              <p className="text-sm text-muted-foreground">Loading certificates...</p>
            </div>
          </div>
        ) : (certificates || []).length > 0 ? (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto -mb-px">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Domains</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Expires</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Auto-Renew</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {certificates.map((cert) => {
                    const expDays = cert.notAfter ? daysUntil(cert.notAfter) : null;
                    return (
                      <tr key={cert.id} className="hover:bg-accent transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{cert.name}</p>
                            {cert.isSystem && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                System
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {cert.domainNames.slice(0, 2).join(", ")}
                            </p>
                            {cert.domainNames.length > 2 && (
                              <p className="text-xs text-muted-foreground">
                                +{cert.domainNames.length - 2} more
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <SSLTypeBadge type={cert.type} />
                        </td>
                        <td className="p-3">
                          <SSLStatusBadge status={cert.status} />
                        </td>
                        <td className="p-3">
                          {cert.notAfter ? (
                            <span
                              className={cn(
                                "text-sm",
                                expDays !== null && expDays <= 7
                                  ? "text-red-600 dark:text-red-400 font-medium"
                                  : expDays !== null && expDays <= 30
                                    ? "text-yellow-600 dark:text-yellow-400"
                                    : "text-muted-foreground"
                              )}
                            >
                              {formatDate(cert.notAfter)}
                              {expDays !== null && expDays > 0 && (
                                <span className="text-xs ml-1">({expDays}d)</span>
                              )}
                              {expDays !== null &&
                                expDays === 0 &&
                                cert.notAfter &&
                                hoursUntil(cert.notAfter) > 0 && (
                                  <span className="text-xs ml-1">
                                    ({hoursUntil(cert.notAfter)}h)
                                  </span>
                                )}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {cert.autoRenew ? (
                            <Badge variant="success">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                        </td>
                        <td className="p-3">
                          {hasScope("ssl:cert:issue") && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {cert.type === "acme" && (
                                  <DropdownMenuItem onClick={() => handleRenew(cert.id)}>
                                    <RefreshCw className="h-4 w-4" />
                                    Renew
                                  </DropdownMenuItem>
                                )}
                                {!cert.isSystem && hasScope("ssl:cert:delete") && (
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(cert.id, cert.name)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            message="No SSL certificates."
            {...(hasScope("ssl:cert:issue")
              ? { actionLabel: "Add one", onAction: () => setCreateDialogOpen(true) }
              : {})}
            hasActiveFilters={hasActiveFilters}
            onReset={() => {
              resetFilters();
              setSearchInput("");
            }}
          />
        )}
      </div>

      <SSLCertificateCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={fetchCertificates}
      />
    </PageTransition>
  );
}
