import {
  Award,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CertificateIssueDialog } from "@/components/certificates/CertificateIssueDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useCertificatesStore } from "@/stores/certificates";
import type { CertificateStatus, CertificateType } from "@/types";
import { formatDate, daysUntil } from "@/lib/utils";

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

const statusBadge = (status: string) => {
  switch (status) {
    case "active":
      return <Badge className="bg-[color:var(--color-success)] text-white">Active</Badge>;
    case "revoked":
      return <Badge variant="destructive">Revoked</Badge>;
    case "expired":
      return <Badge variant="secondary">Expired</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

export function Certificates() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
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
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  const handleSearch = () => {
    setFilters({ search: searchInput });
  };

  const hasActiveFilters =
    filters.status !== "all" || filters.type !== "all" || filters.caId !== "all" || filters.search !== "";

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Certificates</h1>
          <p className="text-sm text-muted-foreground">{total} certificates total</p>
        </div>
        {hasRole("admin", "operator") && (
          <Button onClick={() => setIssueDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Issue Certificate
          </Button>
        )}
      </div>

      {/* Search and filters */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by common name, serial number..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => { resetFilters(); setSearchInput(""); }}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-3 border border-border bg-card p-3">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ status: e.target.value as CertificateStatus | "all" })}
              className="h-9 border border-input bg-transparent px-3 text-sm"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={filters.type}
              onChange={(e) => setFilters({ type: e.target.value as CertificateType | "all" })}
              className="h-9 border border-input bg-transparent px-3 text-sm"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={filters.caId}
              onChange={(e) => setFilters({ caId: e.target.value })}
              className="h-9 border border-input bg-transparent px-3 text-sm"
            >
              <option value="all">All CAs</option>
              {(cas || []).map((ca) => (
                <option key={ca.id} value={ca.id}>{ca.commonName}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
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
                      <td className="p-3 text-sm capitalize text-muted-foreground">{cert.type}</td>
                      <td className="p-3 text-sm text-muted-foreground">{cert.issuerDn || cert.caId}</td>
                      <td className="p-3">
                        <span className={`text-sm ${expDays <= 30 && expDays > 0 ? "text-[color:var(--color-warning)]" : expDays <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {formatDate(cert.notAfter)}
                        </span>
                      </td>
                      <td className="p-3">{statusBadge(cert.status)}</td>
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
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <Award className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No certificates found</p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={() => { resetFilters(); setSearchInput(""); }}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      <CertificateIssueDialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen} />
    </div>
  );
}
