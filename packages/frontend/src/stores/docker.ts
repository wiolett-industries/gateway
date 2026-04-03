import { create } from "zustand";
import { api } from "@/services/api";
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerRegistry,
  DockerTask,
  DockerTemplate,
  DockerVolume,
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
    // Keep original key too so either casing works
    if (key !== k) out[k] = v;
  }
  return out;
}

function normList<T>(data: unknown): T[] {
  const arr = Array.isArray(data) ? data : [];
  return arr.map(norm) as T[];
}

interface DockerFilters {
  search: string;
  status: string; // "all" | "running" | "stopped"
}

interface DockerState {
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
  templates: DockerTemplate[];
  tasks: DockerTask[];
  registries: DockerRegistry[];
  selectedNodeId: string | null;
  filters: DockerFilters;
  isLoading: boolean;

  setSelectedNode: (nodeId: string | null) => void;
  setFilters: (filters: Partial<DockerFilters>) => void;
  resetFilters: () => void;

  fetchContainers: () => Promise<void>;
  fetchImages: () => Promise<void>;
  fetchVolumes: () => Promise<void>;
  fetchNetworks: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchRegistries: () => Promise<void>;

  /** Invalidate specific resources — call after mutations */
  invalidate: (...resources: Array<"containers" | "images" | "volumes" | "networks" | "tasks" | "templates" | "registries">) => Promise<void>;
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
  filters: { search: "", status: "all" },
  isLoading: false,

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
    // Refetch data for new node
    if (nodeId) {
      get().fetchContainers();
      get().fetchImages();
      get().fetchVolumes();
      get().fetchNetworks();
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
  },

  resetFilters: () => {
    set({ filters: { search: "", status: "all" } });
  },

  fetchContainers: async () => {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    set({ isLoading: true });
    try {
      const data = await api.listDockerContainers(selectedNodeId);
      set({ containers: normList<DockerContainer>(data), isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchImages: async () => {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    try {
      const data = await api.listDockerImages(selectedNodeId);
      set({ images: normList<DockerImage>(data) });
    } catch {
      /* swallow */
    }
  },

  fetchVolumes: async () => {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    try {
      const data = await api.listDockerVolumes(selectedNodeId);
      set({ volumes: normList<DockerVolume>(data) });
    } catch {
      /* swallow */
    }
  },

  fetchNetworks: async () => {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    try {
      const data = await api.listDockerNetworks(selectedNodeId);
      set({ networks: normList<DockerNetwork>(data) });
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
