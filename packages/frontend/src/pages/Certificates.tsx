import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CertificateIssueDialog } from "@/components/certificates/CertificateIssueDialog";
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
import { useCertificatesStore } from "@/stores/certificates";
import type { CertificateStatus, CertificateType } from "@/types";

const statusOptions: { value: CertificateStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "revoked", label: "Revoked" },
  { value: "expired", label: "Expired" },
];

const typeOptions: { value: CertificateType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "tls-server", label: "TLS Server" },
  { value: "tls-client", label: "TLS Client" },
  { value: "code-signing", label: "Code Signing" },
  { value: "email", label: "Email" },
];

export function Certificates() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const { cas } = useCAStore();
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
  } = useCertificatesStore();
  const [searchInput, setSearchInput] = useState(filters.search);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  const handleSearch = () => {
    setFilters({ search: searchInput });
  };

  const hasActiveFilters =
    filters.status !== "active" ||
    filters.type !== "all" ||
    filters.caId !== "all" ||
    filters.search !== "";

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Certificates</h1>
            <p className="text-sm text-muted-foreground">{total} certificates total</p>
          </div>
          {hasScope("cert:issue") && (
            <Button onClick={() => setIssueDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Issue Certificate
            </Button>
          )}
        </div>

        {/* Search and filters */}
        <SearchFilterBar
          placeholder="Search by common name, serial number..."
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
                  value={filters.status}
                  onValueChange={(v) => setFilters({ status: v as CertificateStatus | "all" })}
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
              <div className="w-40">
                <Select
                  value={filters.type}
                  onValueChange={(v) => setFilters({ type: v as CertificateType | "all" })}
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
              <div className="w-48">
                <Select value={filters.caId} onValueChange={(v) => setFilters({ caId: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All CAs</SelectItem>
                    {(cas || []).map((ca) => (
                      <SelectItem key={ca.id} value={ca.id}>
                        {ca.commonName}
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
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading certificates...</p>
            </div>
          </div>
        ) : (certificates || []).length > 0 ? (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">Common Name</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Issuing CA</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Expires</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {certificates.map((cert) => {
                    const expDays = daysUntil(cert.notAfter);
                    return (
                      <tr
                        key={cert.id}
                        className="hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => navigate(`/certificates/${cert.id}`)}
                      >
                        <td className="p-3">
                          <div>
                            <p className="text-sm font-medium">{cert.commonName}</p>
                            {(cert.sans?.length ?? 0) > 0 && (
                              <p className="text-xs text-muted-foreground">
                                +{cert.sans.length} SANs
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">{cert.type}</td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {cert.issuerDn || cert.caId}
                        </td>
                        <td className="p-3">
                          <span
                            className={`text-sm ${expDays <= 30 && expDays > 0 ? "text-yellow-600 dark:text-yellow-400" : expDays <= 0 ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {formatDate(cert.notAfter)}
                          </span>
                        </td>
                        <td className="p-3 align-middle">
                          <StatusBadge status={cert.status} />
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
            message="No certificates."
            {...(hasScope("cert:issue")
              ? { actionLabel: "Issue one", onAction: () => setIssueDialogOpen(true) }
              : {})}
            hasActiveFilters={hasActiveFilters}
            onReset={() => {
              resetFilters();
              setSearchInput("");
            }}
          />
        )}

        <CertificateIssueDialog
          open={issueDialogOpen}
          onOpenChange={setIssueDialogOpen}
          onSuccess={fetchCertificates}
        />
      </div>
    </PageTransition>
  );
}
