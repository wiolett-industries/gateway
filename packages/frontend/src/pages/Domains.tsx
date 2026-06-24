import {
  FolderPlus,
  Globe,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { FolderedResourceList } from "@/components/common/FolderedResourceList";
import { PageTransition } from "@/components/common/PageTransition";
import type { ResourceListColumn } from "@/components/common/ResourceListLayout";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
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
import { useRealtime } from "@/hooks/use-realtime";
import { formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DnsStatus, Domain } from "@/types";

const DOMAIN_FOLDER_LIST_CACHE_KEY = "domains:list:folder-view";

export function Domains() {
  const { hasScope } = useAuthStore();
  const canEdit = hasScope("domains:edit");
  const isAdmin = hasScope("domains:delete");
  const canIssueCert = canEdit && hasScope("ssl:cert:issue");

  const cachedDomains = api.getCached<{ data: Domain[] }>(DOMAIN_FOLDER_LIST_CACHE_KEY);
  const [domains, setDomains] = useState<Domain[]>(cachedDomains?.data ?? []);
  const [isLoading, setIsLoading] = useState(!cachedDomains);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DnsStatus | "all">("all");
  const [createFolderAction, setCreateFolderAction] = useState<(() => void) | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadDomains = useCallback(async () => {
    try {
      const result = await api.listDomains({
        page: 1,
        limit: 1000,
      });
      setDomains(result.data);
      api.setCache(DOMAIN_FOLDER_LIST_CACHE_KEY, result);
    } catch {
      toast.error("Failed to load domains");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  useRealtime("domain.changed", () => {
    loadDomains();
  });

  useRealtime("proxy.host.changed", () => {
    loadDomains();
  });

  useRealtime("ssl.cert.changed", () => {
    loadDomains();
  });

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

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all";
  const filteredDomains = useMemo(() => {
    const query = search.trim().toLowerCase();
    return domains.filter((domain) => {
      if (statusFilter !== "all" && domain.dnsStatus !== statusFilter) return false;
      if (!query) return true;
      return [domain.domain, domain.description].some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [domains, search, statusFilter]);
  const canManageFolders = hasScope("domains:folders:manage");
  const domainColumns: ResourceListColumn<Domain>[] = [
    {
      id: "domain",
      label: "Domain",
      width: "minmax(16rem, 1fr)",
      renderCell: (d) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{d.domain}</span>
            {d.isSystem && <Badge variant="outline">System</Badge>}
          </div>
          {d.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{d.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "dns",
      label: "DNS",
      width: "8rem",
      renderCell: (d) => <DnsStatusBadge status={d.dnsStatus} />,
    },
    {
      id: "ssl",
      label: "SSL",
      width: "6rem",
      renderCell: (d) =>
        d.sslCertCount ? (
          <Badge variant="secondary">{d.sslCertCount}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "proxyHosts",
      label: "Proxy Hosts",
      width: "8rem",
      renderCell: (d) =>
        d.proxyHostCount ? (
          <Badge variant="secondary">{d.proxyHostCount}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "added",
      label: "Added",
      width: "8rem",
      renderCell: (d) => (
        <span className="text-xs text-muted-foreground">{formatRelativeDate(d.createdAt)}</span>
      ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      width: "5rem",
      renderCell: (d) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
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
                {canIssueCert && d.dnsStatus === "valid" && !d.sslCertCount && (
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
                    <DropdownMenuItem onClick={() => handleDelete(d)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Domains</h1>
            <p className="text-sm text-muted-foreground">
              Manage domains, track DNS status, and issue certificates
            </p>
          </div>
          <ResponsiveHeaderActions
            actions={[
              ...(canManageFolders && createFolderAction
                ? [
                    {
                      label: "Add Folder",
                      icon: <FolderPlus className="h-4 w-4" />,
                      onClick: createFolderAction,
                    },
                  ]
                : []),
              ...(canEdit
                ? [
                    {
                      label: "Add Domain",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => setAddDialogOpen(true),
                    },
                  ]
                : []),
            ]}
          >
            {canManageFolders && (
              <Button variant="outline" onClick={() => createFolderAction?.()}>
                <FolderPlus className="h-4 w-4" />
                Add Folder
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Domain
              </Button>
            )}
          </ResponsiveHeaderActions>
        </div>

        <FolderedResourceList<Domain>
          resourceType="domain"
          realtimeChannel="domain.changed"
          resources={filteredDomains}
          columns={domainColumns}
          search={{
            placeholder: "Search domains...",
            search,
            onSearchChange: setSearch,
            hasActiveFilters,
            onReset: () => {
              setSearch("");
              setStatusFilter("all");
            },
            filters: (
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as DnsStatus | "all")}
              >
                <SelectTrigger className="w-40">
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
            ),
          }}
          loading={isLoading}
          loadingLabel="Loading domains..."
          emptyState={
            <EmptyState
              message="No domains."
              actionLabel={canEdit ? "Add one" : undefined}
              onAction={canEdit ? () => setAddDialogOpen(true) : undefined}
              hasActiveFilters={hasActiveFilters}
              onReset={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            />
          }
          minWidth={800}
          canManageFolders={canManageFolders}
          canReorganizeItem={() => canManageFolders}
          getResourceLabel={(domain) => domain.domain}
          onItemClick={(domain) => openDetail(domain.id)}
          onRefresh={loadDomains}
          onCreateFolderRef={(fn) => setCreateFolderAction(() => fn)}
        />

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
