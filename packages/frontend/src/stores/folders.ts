import { create } from "zustand";
import { api } from "@/services/api";
import type {
  FolderTreeNode,
  HealthStatus,
  ProxyHost,
  ProxyHostFolder,
  ProxyHostType,
} from "@/types";

interface FolderFilters {
  search: string;
  type: ProxyHostType | "all";
  healthStatus: HealthStatus | "all";
}

interface FolderState {
  // Data
  folders: FolderTreeNode[];
  ungroupedHosts: ProxyHost[];
  totalHosts: number;
  isLoading: boolean;
  error: string | null;

  // Filters
  filters: FolderFilters;

  // Expansion state
  expandedFolderIds: Set<string>;

  // Actions
  fetchGroupedHosts: () => Promise<void>;
  setFilters: (filters: Partial<FolderFilters>) => void;
  resetFilters: () => void;

  // Folder CRUD
  createFolder: (name: string, parentId?: string) => Promise<ProxyHostFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;

  // Host movement
  moveHostsToFolder: (hostIds: string[], folderId: string | null) => Promise<void>;
  reorderHosts: (items: { id: string; sortOrder: number }[]) => Promise<void>;

  // Expansion
  toggleFolder: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

const defaultFilters: FolderFilters = {
  search: "",
  type: "all",
  healthStatus: "all",
};

/** Collect all folder IDs from a tree */
function collectFolderIds(nodes: FolderTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectFolderIds(node.children));
  }
  return ids;
}

/** Collect IDs of folders that contain matching hosts (recursively) */
function collectFoldersWithHosts(nodes: FolderTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const childIds = collectFoldersWithHosts(node.children);
    if (node.hosts.length > 0 || childIds.length > 0) {
      ids.push(node.id);
    }
    ids.push(...childIds);
  }
  return ids;
}

export const useFolderStore = create<FolderState>()((set, get) => ({
  folders: [],
  ungroupedHosts: [],
  totalHosts: 0,
  isLoading: false,
  error: null,
  filters: { ...defaultFilters },
  expandedFolderIds: new Set<string>(),

  fetchGroupedHosts: async () => {
    const { filters } = get();
    set({ isLoading: true, error: null });
    try {
      const response = await api.getGroupedProxyHosts({
        search: filters.search || undefined,
        type: filters.type !== "all" ? filters.type : undefined,
        healthStatus: filters.healthStatus !== "all" ? filters.healthStatus : undefined,
      });
      set((state) => {
        let expandedFolderIds = state.expandedFolderIds;

        // When searching, auto-expand folders with matches
        if (filters.search) {
          const matchingFolderIds = collectFoldersWithHosts(response.folders);
          expandedFolderIds = new Set(matchingFolderIds);
        }

        return {
          folders: response.folders,
          ungroupedHosts: response.ungroupedHosts,
          totalHosts: response.totalHosts,
          isLoading: false,
          expandedFolderIds,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch proxy hosts";
      set({ error: message, isLoading: false });
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    }));
    get().fetchGroupedHosts();
  },

  resetFilters: () => {
    set({ filters: { ...defaultFilters } });
    get().fetchGroupedHosts();
  },

  createFolder: async (name, parentId) => {
    const folder = await api.createFolder({ name, parentId });
    // Auto-expand parent so the new folder is visible
    if (parentId) {
      set((state) => {
        const next = new Set(state.expandedFolderIds);
        next.add(parentId);
        return { expandedFolderIds: next };
      });
    }
    await get().fetchGroupedHosts();
    return folder;
  },

  renameFolder: async (id, name) => {
    await api.updateFolder(id, { name });
    await get().fetchGroupedHosts();
  },

  deleteFolder: async (id) => {
    await api.deleteFolder(id);
    set((state) => {
      const next = new Set(state.expandedFolderIds);
      next.delete(id);
      return { expandedFolderIds: next };
    });
    await get().fetchGroupedHosts();
  },

  moveHostsToFolder: async (hostIds, folderId) => {
    await api.moveHostsToFolder(hostIds, folderId);
    await get().fetchGroupedHosts();
  },

  reorderHosts: async (items) => {
    await api.reorderHosts(items);
    await get().fetchGroupedHosts();
  },

  toggleFolder: (id) => {
    set((state) => {
      const next = new Set(state.expandedFolderIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedFolderIds: next };
    });
  },

  expandAll: () => {
    const { folders } = get();
    set({ expandedFolderIds: new Set(collectFolderIds(folders)) });
  },

  collapseAll: () => {
    set({ expandedFolderIds: new Set() });
  },
}));
