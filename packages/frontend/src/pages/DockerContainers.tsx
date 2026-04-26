import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { FolderCreateDialog } from "@/components/common/FolderCreateDialog";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import {
  DockerContainerRow,
  type DockerContainerRowData,
} from "@/components/docker/DockerContainerRow";
import { DockerDragOverlay } from "@/components/docker/DockerDragOverlay";
import {
  DockerFolderGroup,
  type DockerFolderTreeNodeWithContainers,
} from "@/components/docker/DockerFolderGroup";
import { DockerMoveToFolderDialog } from "@/components/docker/DockerMoveToFolderDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { useDockerFolderStore } from "@/stores/docker-folders";
import type { DockerFolderTreeNode, Node } from "@/types";
import { isNodeIncompatible } from "@/types";
import { DockerDeployDialog } from "./DockerDeployDialog";
import { containerDisplayName } from "./docker-detail/helpers";

function UngroupedDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "docker-folder-ungrouped",
    data: { type: "folder", folderId: null, isSystem: false },
  });

  return (
    <div ref={setNodeRef} className={isOver ? "bg-accent/30" : ""}>
      {children}
    </div>
  );
}

function sortContainers(containers: DockerContainerRowData[]) {
  return [...containers].sort((a, b) => {
    const aOrder = a.folderSortOrder ?? 0;
    const bOrder = b.folderSortOrder ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return containerDisplayName(a.name).localeCompare(containerDisplayName(b.name));
  });
}

function attachContainersToFolders(
  folders: DockerFolderTreeNode[],
  containers: DockerContainerRowData[]
): DockerFolderTreeNodeWithContainers[] {
  const containersByFolder = new Map<string, DockerContainerRowData[]>();
  for (const container of containers) {
    if (!container.folderId) continue;
    const current = containersByFolder.get(container.folderId) ?? [];
    current.push(container);
    containersByFolder.set(container.folderId, current);
  }

  const mapNode = (folder: DockerFolderTreeNode): DockerFolderTreeNodeWithContainers => ({
    ...folder,
    containers: sortContainers(containersByFolder.get(folder.id) ?? []),
    children: folder.children.map(mapNode),
  });

  return folders.map(mapNode);
}

function pruneEmptyFolders(
  folders: DockerFolderTreeNodeWithContainers[]
): DockerFolderTreeNodeWithContainers[] {
  return folders
    .map((folder) => ({ ...folder, children: pruneEmptyFolders(folder.children) }))
    .filter((folder) => folder.containers.length > 0 || folder.children.length > 0);
}

function findContainersInFolder(
  nodes: DockerFolderTreeNodeWithContainers[],
  folderId: string
): DockerContainerRowData[] {
  for (const node of nodes) {
    if (node.id === folderId) return node.containers;
    const found = findContainersInFolder(node.children, folderId);
    if (found.length > 0) return found;
  }
  return [];
}

export function DockerContainers({
  embedded,
  onDeployRef,
  onCreateFolderRef,
  fixedNodeId,
}: {
  embedded?: boolean;
  onDeployRef?: (fn: () => void) => void;
  onCreateFolderRef?: (fn: () => void) => void;
  fixedNodeId?: string;
} = {}) {
  const { hasScope, hasScopedAccess } = useAuthStore();
  const containers = useDockerStore((s) => s.containers) as DockerContainerRowData[];
  const previousContainersRef = useRef(containers);
  const selectedNodeId = useDockerStore((s) => s.selectedNodeId);
  const filters = useDockerStore((s) => s.filters);
  const isLoading = useDockerStore((s) => s.loading.containers);
  const setSelectedNode = useDockerStore((s) => s.setSelectedNode);
  const setFilters = useDockerStore((s) => s.setFilters);
  const resetFilters = useDockerStore((s) => s.resetFilters);
  const fetchContainers = useDockerStore((s) => s.fetchContainers);
  const forceFetchContainers = useDockerStore((s) => s.forceFetchContainers);
  const visibleNodeId = fixedNodeId ?? selectedNodeId;

  const {
    folders,
    isLoading: foldersLoading,
    expandedFolderIds,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    reorderFolders,
    moveContainersToFolder,
    reorderContainers,
    toggleFolder,
  } = useDockerFolderStore();

  const [searchInput, setSearchInput] = useState(filters.search);
  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [deployOpen, setDeployOpen] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [moveDialogContainer, setMoveDialogContainer] = useState<DockerContainerRowData | null>(
    null
  );
  const [activeDrag, setActiveDrag] = useState<DragEndEvent["active"] | null>(null);
  const [optimisticContainers, setOptimisticContainers] = useState<DockerContainerRowData[] | null>(
    null
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const openDeploy = useCallback(() => setDeployOpen(true), []);

  useEffect(() => {
    onDeployRef?.(openDeploy);
  }, [onDeployRef, openDeploy]);

  useEffect(() => {
    onCreateFolderRef?.(() => {
      setCreateFolderParentId(null);
      setCreateFolderOpen(true);
    });
  }, [onCreateFolderRef]);

  useEffect(() => {
    if (fixedNodeId) setSelectedNode(fixedNodeId);
  }, [fixedNodeId, setSelectedNode]);

  useEffect(() => {
    if (embedded || fixedNodeId) return;
    return () => {
      setSelectedNode(null);
    };
  }, [embedded, fixedNodeId, setSelectedNode]);

  const loadDockerNodes = useCallback(async () => {
    setNodesLoading(true);
    try {
      const r = await api.listNodes({ type: "docker", limit: 100 });
      const compatible = r.data.filter(
        (n) => n.status === "online" && n.isConnected && !isNodeIncompatible(n)
      );
      setDockerNodes(compatible);
      useDockerStore.getState().setDockerNodes(compatible);
    } catch {
      toast.error("Failed to load Docker nodes");
    } finally {
      setNodesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (embedded) {
      setNodesLoading(false);
      return;
    }
    void loadDockerNodes();
  }, [embedded, loadDockerNodes]);

  useEffect(() => {
    if (previousContainersRef.current === containers) return;
    previousContainersRef.current = containers;
    setOptimisticContainers(null);
  }, [containers]);

  const refreshData = useCallback(
    async (force = false) => {
      await Promise.all([
        force ? forceFetchContainers(fixedNodeId) : fetchContainers(fixedNodeId),
        fetchFolders(),
      ]);
    },
    [fetchContainers, fetchFolders, fixedNodeId, forceFetchContainers]
  );

  useEffect(() => {
    if (embedded && !fixedNodeId) {
      void fetchFolders();
      return;
    }
    if (!embedded && !fixedNodeId && nodesLoading) return;
    void refreshData();
    const interval = setInterval(() => void refreshData(), 30_000);
    return () => clearInterval(interval);
  }, [embedded, fetchFolders, fixedNodeId, nodesLoading, refreshData]);

  useRealtime("docker.container.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (visibleNodeId && ev.nodeId && ev.nodeId !== visibleNodeId) return;
    void refreshData(true);
  });
  useRealtime("docker.task.changed", (payload) => {
    const ev = payload as { nodeId?: string };
    if (visibleNodeId && ev.nodeId && ev.nodeId !== visibleNodeId) return;
    void refreshData(true);
  });
  useRealtime("docker.folder.changed", () => {
    void fetchFolders();
  });

  const handleSearch = useCallback(() => {
    setFilters({ search: searchInput });
  }, [searchInput, setFilters]);

  const visibleContainers = optimisticContainers ?? containers;

  const filteredContainers = useMemo(() => {
    let result = [...visibleContainers];
    if (filters.status !== "all") {
      result = result.filter((c) =>
        filters.status === "running" ? c.state === "running" : c.state !== "running"
      );
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          containerDisplayName(c.name).toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      );
    }
    return result;
  }, [filters, visibleContainers]);

  const rawFolderTree = useMemo(
    () => attachContainersToFolders(folders, filteredContainers),
    [folders, filteredContainers]
  );
  const folderTree = useMemo(
    () => (fixedNodeId ? pruneEmptyFolders(rawFolderTree) : rawFolderTree),
    [fixedNodeId, rawFolderTree]
  );

  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const ungroupedContainers = useMemo(
    () =>
      sortContainers(
        filteredContainers.filter(
          (container) => !container.folderId || !folderIds.has(container.folderId)
        )
      ),
    [filteredContainers, folderIds]
  );

  const hasActiveFilters = filters.search !== "" || filters.status !== "all";
  const canManageFolders = !fixedNodeId && hasScopedAccess("docker:containers:edit");
  const canManageRuntime = hasScopedAccess("docker:containers:manage");
  const showActionsColumn = canManageFolders || canManageRuntime;
  const showNodeColumn = !fixedNodeId;

  const canViewContainer = useCallback(
    (container: DockerContainerRowData) =>
      hasScope("docker:containers:view") || hasScope(`docker:containers:view:${container._nodeId}`),
    [hasScope]
  );

  const canManageContainer = useCallback(
    (container: DockerContainerRowData) =>
      hasScope("docker:containers:manage") ||
      hasScope(`docker:containers:manage:${container._nodeId}`),
    [hasScope]
  );

  const canReorganizeContainer = useCallback(
    (container: DockerContainerRowData) =>
      !fixedNodeId &&
      !container.folderIsSystem &&
      (hasScope("docker:containers:edit") ||
        hasScope(`docker:containers:edit:${container._nodeId}`)),
    [fixedNodeId, hasScope]
  );

  const doAction = useCallback(
    async (container: DockerContainerRowData, action: string, fn: () => Promise<void>) => {
      const transitionByAction: Record<string, string> = {
        start: "starting",
        stop: "stopping",
        restart: "restarting",
      };
      const transition = transitionByAction[action];
      const containerId = container.id;
      setActionLoading((prev) => ({ ...prev, [containerId]: action }));
      if (transition) {
        setOptimisticContainers((current) =>
          (current ?? containers).map((item) =>
            item._nodeId === container._nodeId && item.id === container.id
              ? { ...item, _transition: transition }
              : item
          )
        );
      }
      try {
        await fn();
        toast.success(`Container ${action} successful`);
        await refreshData(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action} container`);
      } finally {
        setActionLoading((prev) => {
          const copy = { ...prev };
          delete copy[containerId];
          return copy;
        });
      }
    },
    [containers, refreshData]
  );

  const handleStart = useCallback(
    (container: DockerContainerRowData) =>
      doAction(container, "start", async () => {
        if (container.kind === "deployment") {
          await api.startDockerDeployment(
            container._nodeId,
            container.deploymentId ?? container.id
          );
          return;
        }
        await api.startContainer(container._nodeId, container.id);
      }),
    [doAction]
  );

  const handleStop = useCallback(
    (container: DockerContainerRowData) =>
      doAction(container, "stop", async () => {
        if (container.kind === "deployment") {
          await api.stopDockerDeployment(container._nodeId, container.deploymentId ?? container.id);
          return;
        }
        await api.stopContainer(container._nodeId, container.id);
      }),
    [doAction]
  );

  const handleRestart = useCallback(
    (container: DockerContainerRowData) =>
      doAction(container, "restart", async () => {
        if (container.kind === "deployment") {
          await api.restartDockerDeployment(
            container._nodeId,
            container.deploymentId ?? container.id
          );
          return;
        }
        await api.restartContainer(container._nodeId, container.id);
      }),
    [doAction]
  );

  const handleCreateFolder = async (name: string) => {
    try {
      await createFolder(name, createFolderParentId ?? undefined);
      toast.success("Folder created");
      setCreateFolderOpen(false);
      setCreateFolderParentId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder");
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
        "Are you sure? Containers inside will be moved to ungrouped. Subfolders will be deleted.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await deleteFolder(id);
      toast.success("Folder deleted");
      await refreshData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const applyOptimisticMove = useCallback(
    (container: DockerContainerRowData, folderId: string | null) => {
      const targetFolder = folderId
        ? (folders.find((folder) => folder.id === folderId) ?? null)
        : null;
      setOptimisticContainers((current) => {
        const source = (current ?? containers).map((item) => ({ ...item }));
        const moving = source.find(
          (item) => item._nodeId === container._nodeId && item.name === container.name
        );
        if (!moving) return source;

        const maxSortOrder = source.reduce((max, item) => {
          if ((item.folderId ?? null) !== folderId) return max;
          return Math.max(max, item.folderSortOrder ?? 0);
        }, -1);

        moving.folderId = folderId;
        moving.folderIsSystem = targetFolder?.isSystem ?? false;
        moving.folderSortOrder = maxSortOrder + 1;
        return source;
      });
    },
    [containers, folders]
  );

  const applyOptimisticReorder = useCallback(
    (reordered: DockerContainerRowData[]) => {
      setOptimisticContainers((current) => {
        const source = (current ?? containers).map((container) => ({ ...container }));
        const orderMap = new Map<string, number>(
          reordered.map(
            (container, index) => [`${container._nodeId}:${container.name}`, index] as const
          )
        );
        for (const container of source) {
          const key = `${container._nodeId}:${container.name}`;
          if (orderMap.has(key)) {
            container.folderSortOrder = orderMap.get(key);
          }
        }
        return source;
      });
    },
    [containers]
  );

  const moveContainer = useCallback(
    async (container: DockerContainerRowData, folderId: string | null) => {
      applyOptimisticMove(container, folderId);
      try {
        await moveContainersToFolder(
          [{ nodeId: container._nodeId, containerName: container.name }],
          folderId
        );
        toast.success(container.kind === "deployment" ? "Deployment moved" : "Container moved");
        await refreshData(true);
      } catch (err) {
        setOptimisticContainers(null);
        toast.error(err instanceof Error ? err.message : "Failed to move container");
      }
    },
    [applyOptimisticMove, moveContainersToFolder, refreshData]
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    if (!canManageFolders) return;
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const dropData = over.data.current;

    if (activeData?.type === "folder") {
      if (dropData?.type !== "folder" || active.id === over.id) return;
      const findFolderSiblings = (
        nodes: typeof folders,
        folderId: string,
        parentId: string | null = null
      ): { siblings: typeof folders; parentId: string | null } | null => {
        for (const node of nodes) {
          if (node.id === folderId) return { siblings: nodes, parentId };
          const found = findFolderSiblings(node.children as typeof folders, folderId, node.id);
          if (found) return found;
        }
        return null;
      };
      const activeGroup = findFolderSiblings(folders, activeData.folderId as string);
      const overGroup = findFolderSiblings(folders, dropData.folderId as string);
      if (!activeGroup || !overGroup || activeGroup.parentId !== overGroup.parentId) return;
      const oldIndex = activeGroup.siblings.findIndex(
        (folder) => folder.id === activeData.folderId
      );
      const newIndex = overGroup.siblings.findIndex((folder) => folder.id === dropData.folderId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = [...activeGroup.siblings];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      try {
        await reorderFolders(
          reordered.map((folder, index) => ({ id: folder.id, sortOrder: index }))
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reorder folders");
      }
      return;
    }

    const source = activeData?.container as DockerContainerRowData | undefined;
    if (!source || source.folderIsSystem) return;

    if (dropData?.type === "folder") {
      const targetFolderId = dropData.folderId as string | null;
      if (dropData.isSystem || source.folderId === targetFolderId) return;
      await moveContainer(source, targetFolderId);
      return;
    }

    const overContainer = dropData?.container as DockerContainerRowData | undefined;
    if (!overContainer || active.id === over.id) return;
    if (overContainer.folderIsSystem) return;

    if (source.folderId !== overContainer.folderId) {
      await moveContainer(source, overContainer.folderId ?? null);
      return;
    }

    const containersInFolder = source.folderId
      ? findContainersInFolder(folderTree, source.folderId)
      : ungroupedContainers;
    const oldIndex = containersInFolder.findIndex(
      (container) => container._nodeId === source._nodeId && container.name === source.name
    );
    const newIndex = containersInFolder.findIndex(
      (container) =>
        container._nodeId === overContainer._nodeId && container.name === overContainer.name
    );
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reordered = [...containersInFolder];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    applyOptimisticReorder(reordered);

    try {
      await reorderContainers(
        reordered.map((container, index) => ({
          nodeId: container._nodeId,
          containerName: container.name,
          sortOrder: index,
        }))
      );
      await refreshData(true);
    } catch (err) {
      setOptimisticContainers(null);
      toast.error(err instanceof Error ? err.message : "Failed to reorder containers");
    }
  };

  const colGroup = (
    <colgroup>
      <col style={{ width: showNodeColumn ? "30%" : "34%" }} />
      <col style={{ width: showNodeColumn ? "24%" : "32%" }} />
      {showNodeColumn && <col style={{ width: "14%" }} />}
      <col style={{ width: "12%" }} />
      <col style={{ width: showActionsColumn ? "7rem" : "9rem" }} />
      {showActionsColumn && <col style={{ width: "7.5rem" }} />}
    </colgroup>
  );

  const content = (
    <>
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Containers</h1>
              {!isLoading && visibleNodeId && (
                <Badge variant="secondary">{containers.length}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage containers across your Docker nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            {visibleNodeId && (
              <RefreshButton
                onClick={() => void refreshData(true)}
                disabled={isLoading || foldersLoading}
              />
            )}
            {canManageFolders && (
              <Button
                variant="outline"
                onClick={() => {
                  setCreateFolderParentId(null);
                  setCreateFolderOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                New Folder
              </Button>
            )}
            {hasScope("docker:containers:create") && visibleNodeId && (
              <Button onClick={openDeploy}>
                <Plus className="h-4 w-4 mr-1" />
                Deploy Container
              </Button>
            )}
          </div>
        </div>
      )}

      <SearchFilterBar
        search={searchInput}
        onSearchChange={(value) => {
          setSearchInput(value);
          setFilters({ search: value });
        }}
        onSearchSubmit={handleSearch}
        placeholder="Search containers by name or image..."
        hasActiveFilters={searchInput !== "" || filters.status !== "all" || !!selectedNodeId}
        onReset={() => {
          setSearchInput("");
          resetFilters();
          setSelectedNode(null);
        }}
        filters={
          <div className="flex items-center gap-3">
            <Select
              value={selectedNodeId ?? "__all__"}
              onValueChange={(value) => setSelectedNode(value === "__all__" ? null : value)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All nodes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All nodes</SelectItem>
                {(embedded ? useDockerStore.getState().dockerNodes : dockerNodes)
                  .filter((node) => !isNodeIncompatible(node))
                  .map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.displayName || node.hostname}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => setFilters({ status: value })}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {!nodesLoading &&
        !embedded &&
        dockerNodes.length === 0 &&
        useDockerStore.getState().dockerNodes.length === 0 && (
          <EmptyState message="No Docker nodes registered. Add a Docker node from the Nodes page to get started." />
        )}

      {(selectedNodeId || useDockerStore.getState().dockerNodes.length > 0 || embedded) &&
        (isLoading || foldersLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <LoadingSpinner className="" />
              <p className="text-sm text-muted-foreground">Loading containers...</p>
            </div>
          </div>
        ) : filteredContainers.length > 0 || folderTree.length > 0 ? (
          <DndContext
            sensors={sensors}
            onDragStart={(event) => setActiveDrag(event.active)}
            onDragEnd={(event) => void handleDragEnd(event)}
            onDragCancel={() => setActiveDrag(null)}
          >
            <div className="border border-border">
              <table className="w-full" style={{ tableLayout: "fixed" }}>
                {colGroup}
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left">
                    <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Name
                    </th>
                    <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Image
                    </th>
                    {showNodeColumn && (
                      <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Node
                      </th>
                    )}
                    <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Created
                    </th>
                    {showActionsColumn && (
                      <th className="p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
              </table>

              {folderTree.length > 0 && (
                <SortableContext
                  items={folderTree.map((folder) => `docker-folder-${folder.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {folderTree.map((folder) => (
                    <DockerFolderGroup
                      key={folder.id}
                      folder={folder}
                      depth={0}
                      expanded={fixedNodeId ? true : expandedFolderIds.has(folder.id)}
                      onToggle={fixedNodeId ? () => {} : () => toggleFolder(folder.id)}
                      onRename={handleRenameFolder}
                      onDelete={handleDeleteFolder}
                      onRequestCreateSubfolder={(parentId) => {
                        setCreateFolderParentId(parentId);
                        setCreateFolderOpen(true);
                      }}
                      onStart={handleStart}
                      onStop={handleStop}
                      onRestart={handleRestart}
                      actionLoading={actionLoading}
                      onMoveContainerToFolder={setMoveDialogContainer}
                      expandedFolderIds={expandedFolderIds}
                      onToggleFolder={toggleFolder}
                      canManage={canManageContainer}
                      canReorganize={canReorganizeContainer}
                      canView={canViewContainer}
                      canManageFolders={canManageFolders}
                      collapsible={!fixedNodeId}
                      showNode={showNodeColumn}
                      colGroup={colGroup}
                    />
                  ))}
                </SortableContext>
              )}

              {(folderTree.length > 0 || ungroupedContainers.length > 0) &&
                (canManageFolders ? (
                  <UngroupedDropZone>
                    {folderTree.length > 0 && (
                      <div
                        className={`flex items-center justify-between px-3 py-2 ${ungroupedContainers.length > 0 ? "border-b border-border" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Ungrouped</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {ungroupedContainers.length}
                        </Badge>
                      </div>
                    )}
                    {ungroupedContainers.length > 0 && (
                      <SortableContext
                        items={ungroupedContainers.map(
                          (container) => `${container._nodeId}:${container.name}`
                        )}
                        strategy={verticalListSortingStrategy}
                      >
                        <table className="w-full" style={{ tableLayout: "fixed" }}>
                          {colGroup}
                          <tbody className="[&_tr:last-child]:border-b-0">
                            {ungroupedContainers.map((container) => (
                              <DockerContainerRow
                                key={`${container._nodeId}:${container.name}`}
                                container={container}
                                canView={canViewContainer(container)}
                                canManage={canManageContainer(container)}
                                canReorganize={canReorganizeContainer(container)}
                                showNode={showNodeColumn}
                                loadingAction={actionLoading[container.id]}
                                onStart={handleStart}
                                onStop={handleStop}
                                onRestart={handleRestart}
                                onMoveToFolder={setMoveDialogContainer}
                              />
                            ))}
                          </tbody>
                        </table>
                      </SortableContext>
                    )}
                  </UngroupedDropZone>
                ) : (
                  <>
                    {folderTree.length > 0 && ungroupedContainers.length > 0 && (
                      <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Ungrouped</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {ungroupedContainers.length}
                        </Badge>
                      </div>
                    )}
                    {ungroupedContainers.length > 0 && (
                      <table className="w-full" style={{ tableLayout: "fixed" }}>
                        {colGroup}
                        <tbody className="[&_tr:last-child]:border-b-0">
                          {ungroupedContainers.map((container) => (
                            <DockerContainerRow
                              key={`${container._nodeId}:${container.name}`}
                              container={container}
                              canView={canViewContainer(container)}
                              canManage={canManageContainer(container)}
                              canReorganize={false}
                              showNode={showNodeColumn}
                              loadingAction={actionLoading[container.id]}
                              onStart={handleStart}
                              onStop={handleStop}
                              onRestart={handleRestart}
                              onMoveToFolder={setMoveDialogContainer}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                ))}
            </div>
            <DockerDragOverlay active={activeDrag} colGroup={colGroup} />
          </DndContext>
        ) : (
          <EmptyState
            message="No containers found on this node."
            hasActiveFilters={hasActiveFilters}
            onReset={() => {
              setSearchInput("");
              resetFilters();
            }}
            actionLabel={hasScope("docker:containers:create") ? "Deploy a container" : undefined}
            onAction={hasScope("docker:containers:create") ? () => openDeploy() : undefined}
          />
        ))}

      <DockerMoveToFolderDialog
        open={!!moveDialogContainer}
        onOpenChange={(open) => {
          if (!open) setMoveDialogContainer(null);
        }}
        folders={folders}
        currentFolderId={moveDialogContainer?.folderId ?? null}
        onMove={(folderId) => {
          if (moveDialogContainer) void moveContainer(moveDialogContainer, folderId);
        }}
      />

      <FolderCreateDialog
        open={createFolderOpen}
        onOpenChange={(open) => {
          setCreateFolderOpen(open);
          if (!open) setCreateFolderParentId(null);
        }}
        title={createFolderParentId ? "Create Subfolder" : "Create Folder"}
        description={
          createFolderParentId
            ? "Enter a name for the new subfolder."
            : "Enter a name for the new folder."
        }
        onCreate={handleCreateFolder}
      />

      <DockerDeployDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        nodeId={selectedNodeId || undefined}
        dockerNodes={dockerNodes}
        onDeployed={() => void refreshData(true)}
      />
    </>
  );

  if (embedded) {
    return (
      <div className={fixedNodeId ? "flex flex-col flex-1 min-h-0 space-y-4" : "space-y-4"}>
        {content}
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">{content}</div>
    </PageTransition>
  );
}
