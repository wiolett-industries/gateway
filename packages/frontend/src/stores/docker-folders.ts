import { create } from "zustand";
import { api } from "@/services/api";
import type { DockerContainerFolder, DockerFolderTreeNode } from "@/types";

interface DockerFolderState {
  folders: DockerFolderTreeNode[];
  isLoading: boolean;
  error: string | null;
  expandedFolderIds: Set<string>;
  savedExpandedFolderIds: Set<string>;

  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<DockerContainerFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  reorderFolders: (items: { id: string; sortOrder: number }[]) => Promise<void>;
  moveContainersToFolder: (items: Array<{ nodeId: string; containerName: string }>, folderId: string | null) => Promise<void>;
  reorderContainers: (
    items: Array<{ nodeId: string; containerName: string; sortOrder: number }>
  ) => Promise<void>;
  toggleFolder: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

const EXPANDED_DOCKER_FOLDERS_STORAGE_KEY = "docker-folder-expanded";

function loadExpandedFolderIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EXPANDED_DOCKER_FOLDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveExpandedFolderIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPANDED_DOCKER_FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

function collectFolderIds(nodes: DockerFolderTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectFolderIds(node.children));
  }
  return ids;
}

export const useDockerFolderStore = create<DockerFolderState>()((set, get) => ({
  ...(() => {
    const initialExpanded = new Set(loadExpandedFolderIds());
    return {
      expandedFolderIds: initialExpanded,
      savedExpandedFolderIds: initialExpanded,
    };
  })(),
  folders: [],
  isLoading: true,
  error: null,

  fetchFolders: async () => {
    set({ isLoading: get().folders.length === 0, error: null });
    try {
      const folders = await api.listDockerFolders();
      set((state) => ({
        folders,
        isLoading: false,
        expandedFolderIds: new Set(state.savedExpandedFolderIds),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch Docker folders";
      set({ error: message, isLoading: false });
    }
  },

  createFolder: async (name, parentId) => {
    const folder = await api.createDockerFolder({ name, parentId });
    if (parentId) {
      set((state) => {
        const next = new Set(state.savedExpandedFolderIds);
        next.add(parentId);
        saveExpandedFolderIds(next);
        return { expandedFolderIds: new Set(next), savedExpandedFolderIds: next };
      });
    }
    await get().fetchFolders();
    return folder;
  },

  renameFolder: async (id, name) => {
    await api.updateDockerFolder(id, { name });
    await get().fetchFolders();
  },

  deleteFolder: async (id) => {
    await api.deleteDockerFolder(id);
    set((state) => {
      const next = new Set(state.savedExpandedFolderIds);
      next.delete(id);
      saveExpandedFolderIds(next);
      return { expandedFolderIds: new Set(next), savedExpandedFolderIds: next };
    });
    await get().fetchFolders();
  },

  reorderFolders: async (items) => {
    await api.reorderDockerFolders(items);
    await get().fetchFolders();
  },

  moveContainersToFolder: async (items, folderId) => {
    await api.moveDockerContainersToFolder(items, folderId);
    await get().fetchFolders();
  },

  reorderContainers: async (items) => {
    await api.reorderDockerContainers(items);
  },

  toggleFolder: (id) => {
    set((state) => {
      const next = new Set(state.savedExpandedFolderIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpandedFolderIds(next);
      return { expandedFolderIds: new Set(next), savedExpandedFolderIds: next };
    });
  },

  expandAll: () => {
    const next = new Set(collectFolderIds(get().folders));
    saveExpandedFolderIds(next);
    set({ expandedFolderIds: new Set(next), savedExpandedFolderIds: next });
  },

  collapseAll: () => {
    const next = new Set<string>();
    saveExpandedFolderIds(next);
    set({ expandedFolderIds: next, savedExpandedFolderIds: next });
  },
}));
