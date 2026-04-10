import { create } from "zustand";
import { api } from "@/services/api";
import { isNodeIncompatible } from "@/types";
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerRegistry,
  DockerTask,
  DockerTemplate,
  DockerVolume,
  Node,
} from "@/types";

// Docker API returns PascalCase fields; normalize to camelCase for frontend types.
// biome-ignore lint/suspicious/noExplicitAny: raw Docker API response
function norm(item: any): any {
  if (!item || typeof item !== "object") return item;
  if (Array.isArray(item)) return item.map(norm);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    const key = k.charAt(0).toLowerCase() + k.slice(1);
    out[key] = v;
    if (key !== k) out[k] = v;
  }
  return out;
}

function normList<T>(data: unknown): T[] {
  const arr = Array.isArray(data) ? data : [];
  return arr.map(norm) as T[];
}

/** Tag each item with node info for multi-node display */
function tagWithNode<T>(items: T[], nodeId: string, nodeName: string): T[] {
  return items.map((item) => ({ ...item, _nodeId: nodeId, _nodeName: nodeName }));
}

interface DockerFilters {
  search: string;
  status: string;
}

interface DockerState {
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
  templates: DockerTemplate[];
  tasks: DockerTask[];
  registries: DockerRegistry[];
  /** null = all nodes */
  selectedNodeId: string | null;
  /** Cached docker nodes for multi-node fetching */
  dockerNodes: Node[];
  filters: DockerFilters;
  isLoading: boolean;

  setSelectedNode: (nodeId: string | null) => void;
  setDockerNodes: (nodes: Node[]) => void;
  setFilters: (filters: Partial<DockerFilters>) => void;
  resetFilters: () => void;

  fetchContainers: () => Promise<void>;
  /** Fetch containers bypassing API cache — use during transitions */
  forceFetchContainers: () => Promise<void>;
  fetchImages: () => Promise<void>;
  fetchVolumes: () => Promise<void>;
  fetchNetworks: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchRegistries: () => Promise<void>;

  invalidate: (
    ...resources: Array<
      "containers" | "images" | "volumes" | "networks" | "tasks" | "templates" | "registries"
    >
  ) => Promise<void>;
}

async function fetchAllNodes<T>(
  nodes: Node[],
  fetcher: (nodeId: string) => Promise<unknown>,
  normalizer: (data: unknown) => T[],
  setter: (merged: T[]) => void
): Promise<void> {
  const all: T[] = [];
  for (const node of nodes) {
    try {
      const data = await fetcher(node.id);
      const items = normalizer(data);
      const tagged = tagWithNode(items, node.id, node.displayName || node.hostname);
      all.push(...tagged);
      setter([...all]);
    } catch {
      // skip failed nodes
    }
  }
}

export const useDockerStore = create<DockerState>()((set, get) => ({
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  templates: [],
  tasks: [],
  registries: [],
  selectedNodeId: null,
  dockerNodes: [],
  filters: { search: "", status: "all" },
  isLoading: false,

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
    get().fetchContainers();
    get().fetchImages();
    get().fetchVolumes();
    get().fetchNetworks();
  },

  setDockerNodes: (nodes) => set({ dockerNodes: nodes }),

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
  },

  resetFilters: () => {
    set({ filters: { search: "", status: "all" } });
  },

  fetchContainers: async () => {
    const { selectedNodeId, dockerNodes } = get();
    const compatibleNodes = dockerNodes.filter((n) => !isNodeIncompatible(n));
    set({ isLoading: true });
    try {
      if (selectedNodeId) {
        const data = await api.listDockerContainers(selectedNodeId);
        const node = compatibleNodes.find((n) => n.id === selectedNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          selectedNodeId,
          node?.displayName || node?.hostname || ""
        );
        set({ containers: items, isLoading: false });
      } else {
        set({ containers: [] });
        await fetchAllNodes(
          compatibleNodes,
          (nid) => api.listDockerContainers(nid),
          normList<DockerContainer>,
          (merged) => set({ containers: merged })
        );
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  forceFetchContainers: async () => {
    const { selectedNodeId, dockerNodes } = get();
    const compatibleNodes = dockerNodes.filter((n) => !isNodeIncompatible(n));
    try {
      if (selectedNodeId) {
        const data = await api.listDockerContainers(selectedNodeId, true);
        const node = compatibleNodes.find((n) => n.id === selectedNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          selectedNodeId,
          node?.displayName || node?.hostname || ""
        );
        set({ containers: items });
      } else {
        await fetchAllNodes(
          compatibleNodes,
          (nid) => api.listDockerContainers(nid, true),
          normList<DockerContainer>,
          (merged) => set({ containers: merged })
        );
      }
    } catch {
      /* silent */
    }
  },

  fetchImages: async () => {
    const { selectedNodeId, dockerNodes } = get();
    const compatibleNodes = dockerNodes.filter((n) => !isNodeIncompatible(n));
    try {
      if (selectedNodeId) {
        const data = await api.listDockerImages(selectedNodeId);
        const node = compatibleNodes.find((n) => n.id === selectedNodeId);
        set({
          images: tagWithNode(
            normList<DockerImage>(data),
            selectedNodeId,
            node?.displayName || node?.hostname || ""
          ),
        });
      } else {
        set({ images: [] });
        await fetchAllNodes(
          compatibleNodes,
          (nid) => api.listDockerImages(nid),
          normList<DockerImage>,
          (merged) => set({ images: merged })
        );
      }
    } catch {
      /* swallow */
    }
  },

  fetchVolumes: async () => {
    const { selectedNodeId, dockerNodes } = get();
    const compatibleNodes = dockerNodes.filter((n) => !isNodeIncompatible(n));
    try {
      if (selectedNodeId) {
        const data = await api.listDockerVolumes(selectedNodeId);
        const node = compatibleNodes.find((n) => n.id === selectedNodeId);
        set({
          volumes: tagWithNode(
            normList<DockerVolume>(data),
            selectedNodeId,
            node?.displayName || node?.hostname || ""
          ),
        });
      } else {
        set({ volumes: [] });
        await fetchAllNodes(
          compatibleNodes,
          (nid) => api.listDockerVolumes(nid),
          normList<DockerVolume>,
          (merged) => set({ volumes: merged })
        );
      }
    } catch {
      /* swallow */
    }
  },

  fetchNetworks: async () => {
    const { selectedNodeId, dockerNodes } = get();
    const compatibleNodes = dockerNodes.filter((n) => !isNodeIncompatible(n));
    try {
      if (selectedNodeId) {
        const data = await api.listDockerNetworks(selectedNodeId);
        const node = compatibleNodes.find((n) => n.id === selectedNodeId);
        set({
          networks: tagWithNode(
            normList<DockerNetwork>(data),
            selectedNodeId,
            node?.displayName || node?.hostname || ""
          ),
        });
      } else {
        set({ networks: [] });
        await fetchAllNodes(
          compatibleNodes,
          (nid) => api.listDockerNetworks(nid),
          normList<DockerNetwork>,
          (merged) => set({ networks: merged })
        );
      }
    } catch {
      /* swallow */
    }
  },

  fetchTemplates: async () => {
    try {
      const data = await api.listDockerTemplates();
      set({ templates: data ?? [] });
    } catch {
      /* swallow */
    }
  },

  fetchTasks: async () => {
    try {
      const { selectedNodeId } = get();
      const data = await api.listDockerTasks(
        selectedNodeId ? { nodeId: selectedNodeId } : undefined
      );
      set({ tasks: data ?? [] });
    } catch {
      /* swallow */
    }
  },

  fetchRegistries: async () => {
    try {
      const data = await api.listDockerRegistries();
      set({ registries: data ?? [] });
    } catch {
      /* swallow */
    }
  },

  invalidate: async (...resources) => {
    const s = get();
    const map: Record<string, () => Promise<void>> = {
      containers: s.fetchContainers,
      images: s.fetchImages,
      volumes: s.fetchVolumes,
      networks: s.fetchNetworks,
      tasks: s.fetchTasks,
      templates: s.fetchTemplates,
      registries: s.fetchRegistries,
    };
    await Promise.all(resources.map((r) => map[r]?.()));
  },
}));
