import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { FolderPlus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { CreateProxyHostDialog } from "@/components/proxy/CreateProxyHostDialog";
import { DragOverlay } from "@/components/proxy/DragOverlay";
import { FolderGroup } from "@/components/proxy/FolderGroup";
import { InlineFolderEditor } from "@/components/proxy/InlineFolderEditor";
import { MoveToFolderDialog } from "@/components/proxy/MoveToFolderDialog";
import { ProxyHostRow } from "@/components/proxy/ProxyHostRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useFolderStore } from "@/stores/folders";
import type { HealthStatus, ProxyHostType } from "@/types";

const typeOptions: { value: ProxyHostType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "proxy", label: "Proxy" },
  { value: "redirect", label: "Redirect" },
  { value: "404", label: "404" },
];

const healthOptions: { value: HealthStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "degraded", label: "Degraded" },
  { value: "unknown", label: "Unknown" },
  { value: "disabled", label: "Disabled" },
];

function UngroupedDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "folder-ungrouped",
    data: { type: "folder", folderId: null },
  });

  return (
    <div ref={setNodeRef} className={isOver ? "bg-accent/30" : ""}>
      {children}
    </div>
  );
}

export function ProxyHosts() {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const {
    folders,
    ungroupedHosts,
    totalHosts,
    isLoading,
    filters,
    expandedFolderIds,
    fetchGroupedHosts,
    setFilters,
    resetFilters,
    createFolder,
    renameFolder,
    deleteFolder,
    moveHostsToFolder,
    reorderHosts,
    toggleFolder,
  } = useFolderStore();

  const [searchInput, setSearchInput] = useState(filters.search);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [moveDialogHostId, setMoveDialogHostId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragEndEvent["active"] | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  useEffect(() => {
    fetchGroupedHosts();
  }, [fetchGroupedHosts]);

  const handleSearch = () => {
    setFilters({ search: searchInput });
  };

  const hasActiveFilters =
    filters.type !== "all" || filters.healthStatus !== "all" || filters.search !== "";

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(id));
    try {
      await api.toggleProxyHost(id, !currentEnabled);
      api.invalidateCache();
      toast.success(currentEnabled ? "Proxy host disabled" : "Proxy host enabled");
      await fetchGroupedHosts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle proxy host");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCreateFolder = async (name: string) => {
    try {
      await createFolder(name);
      toast.success("Folder created");
      setIsCreatingFolder(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder");
    }
  };

  const handleCreateSubfolder = async (parentId: string, name: string) => {
    try {
      await createFolder(name, parentId);
      toast.success("Subfolder created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create subfolder");
    }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      toast.success("Folder renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename folder");
    }
  };

  const handleDeleteFolder = async (id: string) => {
    const ok = await confirm({
      title: "Delete Folder",
      description:
        "Are you sure? Hosts inside will be moved to ungrouped. Subfolders will be deleted.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await deleteFolder(id);
      toast.success("Folder deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const handleMoveHost = async (folderId: string | null) => {
    if (!moveDialogHostId) return;
    try {
      await moveHostsToFolder([moveDialogHostId], folderId);
      toast.success("Host moved");
      setMoveDialogHostId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move host");
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const hostData = active.data.current;
    if (hostData?.type !== "host") return;

    const hostId = active.id as string;
    const host = hostData.host;
    const dropData = over.data.current;

    // Dropped on a folder header → move to folder
    if (dropData?.type === "folder") {
      const targetFolderId = dropData.folderId as string | null;
      if (host.folderId === targetFolderId) return;
      try {
        await moveHostsToFolder([hostId], targetFolderId);
        toast.success("Host moved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move host");
      }
      return;
    }

    // Dropped on another host → reorder within the same folder
    if (dropData?.type === "host" && active.id !== over.id) {
      const overHost = dropData.host;
      // Only reorder if same folder
      if (host.folderId !== overHost.folderId) {
        // Different folders: move to that folder
        try {
          await moveHostsToFolder([hostId], overHost.folderId);
          toast.success("Host moved");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to move host");
        }
        return;
      }

      // Same folder: reorder
      const hostsInFolder = host.folderId ? findHostsInFolder(host.folderId) : ungroupedHosts;

      const oldIndex = hostsInFolder.findIndex((h) => h.id === hostId);
      const newIndex = hostsInFolder.findIndex((h) => h.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      // Build new order
      const reordered = [...hostsInFolder];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      try {
        await reorderHosts(reordered.map((h, i) => ({ id: h.id, sortOrder: i })));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reorder");
      }
    }
  };

  const findHostsInFolder = (folderId: string): typeof ungroupedHosts => {
    const search = (nodes: typeof folders): typeof ungroupedHosts | null => {
      for (const node of nodes) {
        if (node.id === folderId) return node.hosts;
        const found = search(node.children);
        if (found) return found;
      }
      return null;
    };
    return search(folders) ?? [];
  };

  // Find current folder of host being moved (for dialog default)
  const findHostFolderId = (hostId: string): string | null => {
    for (const host of ungroupedHosts) {
      if (host.id === hostId) return null;
    }
    const search = (nodes: typeof folders): string | null => {
      for (const node of nodes) {
        for (const host of node.hosts) {
          if (host.id === hostId) return node.id;
        }
        const found = search(node.children);
        if (found !== null) return found;
      }
      return null;
    };
    return search(folders);
  };

  const colGroup = (
    <colgroup>
      <col style={{ width: "30%" }} />
      <col style={{ width: "25%" }} />
      <col style={{ width: "10%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "10%" }} />
      <col style={{ width: "8%" }} />
      {hasScope("proxy:edit") && <col style={{ width: "48px" }} />}
    </colgroup>
  );

  const tableHeaders = (
    <thead>
      <tr className="border-b border-border text-left">
        <th className="p-3 text-xs font-medium text-muted-foreground">Domain Names</th>
        <th className="p-3 text-xs font-medium text-muted-foreground">Upstream</th>
        <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
        <th className="p-3 text-xs font-medium text-muted-foreground">SSL</th>
        <th className="p-3 text-xs font-medium text-muted-foreground">Health</th>
        <th className="p-3 text-xs font-medium text-muted-foreground">Enabled</th>
        {hasScope("proxy:edit") && (
          <th className="p-3 text-xs font-medium text-muted-foreground w-10"></th>
        )}
      </tr>
    </thead>
  );

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Proxy Hosts</h1>
            <p className="text-sm text-muted-foreground">{totalHosts} proxy hosts total</p>
          </div>
          <div className="flex items-center gap-2">
            {hasScope("proxy:edit") && (
              <Button variant="outline" onClick={() => setIsCreatingFolder(true)}>
                <FolderPlus className="h-4 w-4" />
                Add Folder
              </Button>
            )}
            {hasScope("proxy:create") && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Proxy Host
              </Button>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <SearchFilterBar
          placeholder="Search by domain name..."
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
                  onValueChange={(v) => setFilters({ type: v as ProxyHostType | "all" })}
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
                  value={filters.healthStatus}
                  onValueChange={(v) => setFilters({ healthStatus: v as HealthStatus | "all" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {healthOptions.map((opt) => (
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

        {/* Inline new folder creation */}
        {isCreatingFolder && (
          <div className="border border-border bg-card px-3 py-2">
            <InlineFolderEditor
              onSave={handleCreateFolder}
              onCancel={() => setIsCreatingFolder(false)}
            />
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading proxy hosts...</p>
            </div>
          </div>
        ) : folders.length > 0 || ungroupedHosts.length > 0 ? (
          <DndContext
            sensors={sensors}
            onDragStart={(event) => setActiveDrag(event.active)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDrag(null)}
          >
            <div className="border border-border bg-card">
              {/* Table header */}
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout: "fixed" }}>
                  {colGroup}
                  {tableHeaders}
                </table>
              </div>

              {/* Folders */}
              {folders.map((folder) => (
                <FolderGroup
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  expanded={expandedFolderIds.has(folder.id)}
                  onToggle={() => toggleFolder(folder.id)}
                  onRename={handleRenameFolder}
                  onDelete={handleDeleteFolder}
                  onCreateSubfolder={handleCreateSubfolder}
                  onToggleHost={handleToggle}
                  togglingIds={togglingIds}
                  onMoveHostToFolder={(hostId) => setMoveDialogHostId(hostId)}
                  expandedFolderIds={expandedFolderIds}
                  onToggleFolder={toggleFolder}
                  canManage={hasScope("proxy:edit")}
                  colGroup={colGroup}
                />
              ))}

              {/* Ungrouped hosts — always visible when folders exist so it's a drop target */}
              {(folders.length > 0 || ungroupedHosts.length > 0) && (
                <UngroupedDropZone>
                  {folders.length > 0 && (
                    <div className="flex items-center gap-2 py-2 px-3 border-b border-border">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Ungrouped
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {ungroupedHosts.length}
                      </Badge>
                    </div>
                  )}
                  {ungroupedHosts.length > 0 && (
                    <SortableContext
                      items={ungroupedHosts.map((h) => h.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <table className="w-full" style={{ tableLayout: "fixed" }}>
                        {colGroup}
                        <tbody>
                          {ungroupedHosts.map((host) => (
                            <ProxyHostRow
                              key={host.id}
                              host={host}
                              onToggle={handleToggle}
                              togglingIds={togglingIds}
                              onMoveToFolder={(hostId) => setMoveDialogHostId(hostId)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </SortableContext>
                  )}
                </UngroupedDropZone>
              )}
            </div>

            <DragOverlay active={activeDrag} />
          </DndContext>
        ) : (
          <EmptyState
            message="No proxy hosts."
            {...(hasScope("proxy:edit")
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

      {/* Move to folder dialog */}
      <MoveToFolderDialog
        open={moveDialogHostId !== null}
        onOpenChange={(open) => {
          if (!open) setMoveDialogHostId(null);
        }}
        folders={folders}
        currentFolderId={moveDialogHostId ? findHostFolderId(moveDialogHostId) : null}
        onMove={handleMoveHost}
      />

      <CreateProxyHostDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={(hostId) => {
          fetchGroupedHosts();
          navigate(`/proxy-hosts/${hostId}`);
        }}
      />
    </PageTransition>
  );
}
