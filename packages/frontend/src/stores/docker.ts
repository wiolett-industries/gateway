import { create } from "zustand";
import { api } from "@/services/api";
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerRegistry,
  DockerTask,
  DockerVolume,
  Node,
} from "@/types";
import { isNodeIncompatible } from "@/types";

// Docker API returns PascalCase fields; normalize to camelCase for frontend types.
function norm(item: unknown): unknown {
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

  fetchContainers: (nodeIdOverride?: string | null) => Promise<void>;
  /** Fetch containers bypassing API cache — use during transitions */
  forceFetchContainers: (nodeIdOverride?: string | null) => Promise<void>;
  fetchImages: (nodeIdOverride?: string | null) => Promise<void>;
  fetchVolumes: (nodeIdOverride?: string | null) => Promise<void>;
  fetchNetworks: (nodeIdOverride?: string | null) => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchRegistries: () => Promise<void>;

  invalidate: (
    ...resources: Array<"containers" | "images" | "volumes" | "networks" | "tasks" | "registries">
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
  tasks: [],
  registries: [],
  selectedNodeId: null,
  dockerNodes: [],
  filters: { search: "", status: "all" },
  isLoading: true,

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  setDockerNodes: (nodes) =>
    set({
      dockerNodes: nodes.filter((n) => n.status === "online" && !isNodeIncompatible(n)),
    }),

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
  },

  resetFilters: () => {
    set({ filters: { search: "", status: "all" } });
  },

  fetchContainers: async (nodeIdOverride) => {
    const { selectedNodeId, dockerNodes } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    set({ isLoading: get().containers.length === 0 });
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerContainers(effectiveNodeId);
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          effectiveNodeId,
          node?.displayName || node?.hostname || ""
        );
        set({ containers: items, isLoading: false });
      } else {
        set({ containers: [] });
        await fetchAllNodes(
          dockerNodes,
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

  forceFetchContainers: async (nodeIdOverride) => {
    const { selectedNodeId, dockerNodes } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerContainers(effectiveNodeId, true);
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          effectiveNodeId,
          node?.displayName || node?.hostname || ""
        );
        set({ containers: items });
      } else {
        await fetchAllNodes(
          dockerNodes,
          (nid) => api.listDockerContainers(nid, true),
          normList<DockerContainer>,
          (merged) => set({ containers: merged })
        );
      }
    } catch {
      /* silent */
    }
  },

  fetchImages: async (nodeIdOverride) => {
    const { selectedNodeId, dockerNodes } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    set({ isLoading: get().images.length === 0 });
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerImages(effectiveNodeId);
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        set({
          images: tagWithNode(
            normList<DockerImage>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          isLoading: false,
        });
      } else {
        set({ images: [] });
        await fetchAllNodes(
          dockerNodes,
          (nid) => api.listDockerImages(nid),
          normList<DockerImage>,
          (merged) => set({ images: merged })
        );
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  fetchVolumes: async (nodeIdOverride) => {
    const { selectedNodeId, dockerNodes } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    set({ isLoading: get().volumes.length === 0 });
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerVolumes(effectiveNodeId);
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        set({
          volumes: tagWithNode(
            normList<DockerVolume>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          isLoading: false,
        });
      } else {
        set({ volumes: [] });
        await fetchAllNodes(
          dockerNodes,
          (nid) => api.listDockerVolumes(nid),
          normList<DockerVolume>,
          (merged) => set({ volumes: merged })
        );
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  fetchNetworks: async (nodeIdOverride) => {
    const { selectedNodeId, dockerNodes } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    set({ isLoading: get().networks.length === 0 });
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerNetworks(effectiveNodeId);
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        set({
          networks: tagWithNode(
            normList<DockerNetwork>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          isLoading: false,
        });
      } else {
        set({ networks: [] });
        await fetchAllNodes(
          dockerNodes,
          (nid) => api.listDockerNetworks(nid),
          normList<DockerNetwork>,
          (merged) => set({ networks: merged })
        );
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  fetchTasks: async () => {
    set({ isLoading: get().tasks.length === 0 });
    try {
      const { selectedNodeId } = get();
      const data = await api.listDockerTasks(
        selectedNodeId ? { nodeId: selectedNodeId } : undefined
      );
      set({ tasks: data ?? [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchRegistries: async () => {
    set({ isLoading: get().registries.length === 0 });
    try {
      const data = await api.listDockerRegistries();
      set({ registries: data ?? [], isLoading: false });
    } catch {
      set({ isLoading: false });
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
      registries: s.fetchRegistries,
    };
    await Promise.all(resources.map((r) => map[r]?.()));
  },
}));
