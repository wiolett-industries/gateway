import {
  ChevronLeft,
  ChevronRight,
  Globe,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { AddDomainDialog } from "@/components/domains/AddDomainDialog";
import { DnsStatusBadge } from "@/components/domains/DnsStatusBadge";
import { DomainDetailDialog } from "@/components/domains/DomainDetailDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DnsStatus, Domain } from "@/types";

export function Domains() {
  const { hasRole } = useAuthStore();
  const canEdit = hasRole("admin", "operator");
  const isAdmin = hasRole("admin");

  const cachedDomains = api.getCached<{ data: Domain[]; pagination: { totalPages: number } }>(
    "domains:list"
  );
  const [domains, setDomains] = useState<Domain[]>(cachedDomains?.data ?? []);
  const [isLoading, setIsLoading] = useState(!cachedDomains);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DnsStatus | "all">("all");

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadDomains = async () => {
    try {
      const result = await api.listDomains({
        page,
        limit: 20,
        search: search || undefined,
        dnsStatus: statusFilter !== "all" ? statusFilter : undefined,
      });
      setDomains(result.data);
      setTotalPages(result.pagination.totalPages);
      if (page === 1 && !search && statusFilter === "all") api.setCache("domains:list", result);
    } catch {
      toast.error("Failed to load domains");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  const handleCheckDns = async (d: Domain) => {
    try {
      await api.checkDomainDns(d.id);
      toast.success(`DNS check complete for ${d.domain}`);
      loadDomains();
    } catch {
      toast.error("DNS check failed");
    }
  };

  const handleIssueCert = async (d: Domain) => {
    try {
      await api.issueDomainCert(d.id);
      toast.success(`Certificate issued for ${d.domain}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue cert");
    }
  };

  const handleDelete = async (d: Domain) => {
    const ok = await confirm({
      title: "Delete Domain",
      description: `Are you sure you want to delete "${d.domain}"? This won't affect proxy hosts or certificates using this domain.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteDomain(d.id);
      toast.success("Domain deleted");
      loadDomains();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete domain";
      if (msg.includes("in use")) {
        toast.error(
          "Cannot delete: domain is used by proxy hosts. Remove it from proxy hosts first."
        );
      } else if (msg.includes("System")) {
        toast.error("System domains cannot be deleted.");
      } else {
        toast.error(msg);
      }
    }
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
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
            <h1 className="text-2xl font-bold">Domains</h1>
            <p className="text-sm text-muted-foreground">
              Manage domains, track DNS status, and issue certificates
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Domain
            </Button>
          )}
        </div>

        {/* Search and filters */}
        <SearchFilterBar
          placeholder="Search domains..."
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          hasActiveFilters={statusFilter !== "all"}
          onReset={() => {
            setSearch("");
            setStatusFilter("all");
            setPage(1);
          }}
          filters={
            <div className="w-40">
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as DnsStatus | "all");
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="DNS Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="valid">Valid</SelectItem>
                  <SelectItem value="invalid">Invalid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />

        {/* Table */}
        {domains.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">Domain</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">DNS</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">SSL</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Proxy Hosts</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Added</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {domains.map((d) => (
                    <tr
                      key={d.id}
                      className="hover:bg-accent transition-colors cursor-pointer"
                      onClick={() => openDetail(d.id)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium">{d.domain}</span>
                          {d.isSystem && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              System
                            </Badge>
                          )}
                        </div>
                        {d.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {d.description}
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        <DnsStatusBadge status={d.dnsStatus} />
                      </td>
                      <td className="p-3">
                        {d.sslCertCount ? (
                          <Badge variant="secondary">{d.sslCertCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {d.proxyHostCount ? (
                          <Badge variant="secondary">{d.proxyHostCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeDate(d.createdAt)}
                        </span>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleCheckDns(d)}>
                                <RefreshCw className="h-4 w-4" />
                                Check DNS
                              </DropdownMenuItem>
                              {d.dnsStatus === "valid" && !d.sslCertCount && (
                                <DropdownMenuItem onClick={() => handleIssueCert(d)}>
                                  <Shield className="h-4 w-4" />
                                  Issue Cert
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openDetail(d.id)}>
                                <Pencil className="h-4 w-4" />
                                Details
                              </DropdownMenuItem>
                              {isAdmin && !d.isSystem && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(d)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  ))}
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
            message="No domains."
            actionLabel="Add one"
            onAction={() => setAddDialogOpen(true)}
          />
        )}

        <AddDomainDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onCreated={loadDomains}
        />
        <DomainDetailDialog
          domainId={detailId}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onUpdated={loadDomains}
        />
      </div>
    </PageTransition>
  );
}
