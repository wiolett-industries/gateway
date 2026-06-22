import { create } from "zustand";
import { api } from "@/services/api";
import type { ResourceFolder, ResourceFolderTreeNode, ResourceFolderType } from "@/types";

type FolderResourceMap<T> = Record<ResourceFolderType, T>;

interface ResourceFolderState {
  foldersByType: FolderResourceMap<ResourceFolderTreeNode[]>;
  loadingByType: FolderResourceMap<boolean>;
  errorByType: FolderResourceMap<string | null>;
  expandedFolderIdsByType: FolderResourceMap<Set<string>>;
  savedExpandedFolderIdsByType: FolderResourceMap<Set<string>>;
  fetchFolders: (type: ResourceFolderType) => Promise<void>;
  createFolder: (
    type: ResourceFolderType,
    name: string,
    parentId?: string
  ) => Promise<ResourceFolder>;
  renameFolder: (type: ResourceFolderType, id: string, name: string) => Promise<void>;
  deleteFolder: (type: ResourceFolderType, id: string) => Promise<void>;
  reorderFolders: (
    type: ResourceFolderType,
    items: { id: string; sortOrder: number }[]
  ) => Promise<void>;
  moveResourcesToFolder: (
    type: ResourceFolderType,
    ids: string[],
    folderId: string | null
  ) => Promise<void>;
  reorderResources: (
    type: ResourceFolderType,
    items: { id: string; sortOrder: number }[]
  ) => Promise<void>;
  toggleFolder: (type: ResourceFolderType, id: string) => void;
}

const RESOURCE_TYPES: ResourceFolderType[] = ["node", "database"];
const EXPANDED_STORAGE_KEY = "resource-folder-expanded";

function resourceMap<T>(value: (type: ResourceFolderType) => T): FolderResourceMap<T> {
  return Object.fromEntries(
    RESOURCE_TYPES.map((type) => [type, value(type)])
  ) as FolderResourceMap<T>;
}

function storageKey(type: ResourceFolderType) {
  return `${EXPANDED_STORAGE_KEY}:${type}`;
}

function loadExpandedFolderIds(type: ResourceFolderType): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(type));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function saveExpandedFolderIds(type: ResourceFolderType, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(type), JSON.stringify(Array.from(ids)));
  } catch {}
}

function applyFolderOrder(
  nodes: ResourceFolderTreeNode[],
  items: { id: string; sortOrder: number }[]
): ResourceFolderTreeNode[] {
  const orderMap = new Map(items.map((item) => [item.id, item.sortOrder]));
  const visit = (current: ResourceFolderTreeNode[]): ResourceFolderTreeNode[] => {
    const hasTarget = current.some((node) => orderMap.has(node.id));
    const next = current.map((node) => ({ ...node, children: visit(node.children) }));
    if (!hasTarget) return next;
    return [...next].sort((a, b) => {
      const aOrder = orderMap.get(a.id);
      const bOrder = orderMap.get(b.id);
      if (aOrder == null && bOrder == null) return 0;
      if (aOrder == null) return -1;
      if (bOrder == null) return 1;
      return aOrder - bOrder;
    });
  };
  return visit(nodes);
}

const fetchRequestIds = resourceMap(() => 0);

export const useResourceFolderStore = create<ResourceFolderState>()((set, get) => {
  const initialExpanded = resourceMap((type) => new Set(loadExpandedFolderIds(type)));

  return {
    foldersByType: resourceMap(() => []),
    loadingByType: resourceMap(() => true),
    errorByType: resourceMap(() => null),
    expandedFolderIdsByType: initialExpanded,
    savedExpandedFolderIdsByType: initialExpanded,

    fetchFolders: async (type) => {
      const requestId = ++fetchRequestIds[type];
      set((state) => ({
        loadingByType: {
          ...state.loadingByType,
          [type]: state.foldersByType[type].length === 0,
        },
        errorByType: { ...state.errorByType, [type]: null },
      }));
      try {
        const folders =
          type === "node" ? await api.listNodeFolders() : await api.listDatabaseFolders();
        if (requestId !== fetchRequestIds[type]) return;
        set((state) => ({
          foldersByType: { ...state.foldersByType, [type]: folders },
          loadingByType: { ...state.loadingByType, [type]: false },
          expandedFolderIdsByType: {
            ...state.expandedFolderIdsByType,
            [type]: new Set(state.savedExpandedFolderIdsByType[type]),
          },
        }));
      } catch (err) {
        if (requestId !== fetchRequestIds[type]) return;
        set((state) => ({
          errorByType: {
            ...state.errorByType,
            [type]: err instanceof Error ? err.message : "Failed to fetch folders",
          },
          loadingByType: { ...state.loadingByType, [type]: false },
        }));
      }
    },

    createFolder: async (type, name, parentId) => {
      const folder =
        type === "node"
          ? await api.createNodeFolder({ name, parentId })
          : await api.createDatabaseFolder({ name, parentId });
      if (parentId) {
        set((state) => {
          const next = new Set(state.savedExpandedFolderIdsByType[type]);
          next.add(parentId);
          saveExpandedFolderIds(type, next);
          return {
            expandedFolderIdsByType: { ...state.expandedFolderIdsByType, [type]: new Set(next) },
            savedExpandedFolderIdsByType: { ...state.savedExpandedFolderIdsByType, [type]: next },
          };
        });
      }
      await get().fetchFolders(type);
      return folder;
    },

    renameFolder: async (type, id, name) => {
      if (type === "node") await api.updateNodeFolder(id, { name });
      else await api.updateDatabaseFolder(id, { name });
      await get().fetchFolders(type);
    },

    deleteFolder: async (type, id) => {
      if (type === "node") await api.deleteNodeFolder(id);
      else await api.deleteDatabaseFolder(id);
      set((state) => {
        const next = new Set(state.savedExpandedFolderIdsByType[type]);
        next.delete(id);
        saveExpandedFolderIds(type, next);
        return {
          expandedFolderIdsByType: { ...state.expandedFolderIdsByType, [type]: new Set(next) },
          savedExpandedFolderIdsByType: { ...state.savedExpandedFolderIdsByType, [type]: next },
        };
      });
      await get().fetchFolders(type);
    },

    reorderFolders: async (type, items) => {
      const previous = get().foldersByType[type];
      set((state) => ({
        foldersByType: { ...state.foldersByType, [type]: applyFolderOrder(previous, items) },
      }));
      try {
        if (type === "node") await api.reorderNodeFolders(items);
        else await api.reorderDatabaseFolders(items);
        await get().fetchFolders(type);
      } catch (err) {
        set((state) => ({ foldersByType: { ...state.foldersByType, [type]: previous } }));
        throw err;
      }
    },

    moveResourcesToFolder: async (type, ids, folderId) => {
      if (type === "node") await api.moveNodesToFolder(ids, folderId);
      else await api.moveDatabasesToFolder(ids, folderId);
      await get().fetchFolders(type);
    },

    reorderResources: async (type, items) => {
      if (type === "node") await api.reorderNodes(items);
      else await api.reorderDatabases(items);
    },

    toggleFolder: (type, id) => {
      set((state) => {
        const next = new Set(state.savedExpandedFolderIdsByType[type]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveExpandedFolderIds(type, next);
        return {
          expandedFolderIdsByType: { ...state.expandedFolderIdsByType, [type]: new Set(next) },
          savedExpandedFolderIdsByType: { ...state.savedExpandedFolderIdsByType, [type]: next },
        };
      });
    },
  };
});
