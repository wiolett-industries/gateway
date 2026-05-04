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

type DockerResource = "containers" | "images" | "volumes" | "networks" | "tasks" | "registries";

interface DockerState {
  containers: DockerContainer[];
  containersByScope: Record<string, DockerContainer[]>;
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
  tasks: DockerTask[];
  registries: DockerRegistry[];
  /** null = all nodes */
  selectedNodeId: string | null;
  /** Cached docker nodes for multi-node fetching */
  dockerNodes: Node[];
  dockerNodesLoaded: boolean;
  filters: DockerFilters;
  loading: Record<DockerResource, boolean>;
  /** Deprecated aggregate loading state kept for older selectors. */
  isLoading: boolean;

  setSelectedNode: (nodeId: string | null) => void;
  setDockerNodes: (nodes: Node[]) => void;
  setFilters: (filters: Partial<DockerFilters>) => void;
  resetFilters: () => void;

  fetchContainers: (
    nodeIdOverride?: string | null,
    searchOverride?: string,
    nodesOverride?: Node[]
  ) => Promise<void>;
  /** Fetch containers bypassing API cache — use during transitions */
  forceFetchContainers: (nodeIdOverride?: string | null, searchOverride?: string) => Promise<void>;
  fetchImages: (
    nodeIdOverride?: string | null,
    searchOverride?: string,
    nodesOverride?: Node[]
  ) => Promise<void>;
  fetchVolumes: (
    nodeIdOverride?: string | null,
    searchOverride?: string,
    nodesOverride?: Node[]
  ) => Promise<void>;
  fetchNetworks: (
    nodeIdOverride?: string | null,
    searchOverride?: string,
    nodesOverride?: Node[]
  ) => Promise<void>;
  fetchTasks: (nodeIdOverride?: string | null) => Promise<void>;
  fetchRegistries: () => Promise<void>;

  invalidate: (...resources: DockerResource[]) => Promise<void>;
}

const GLOBAL_DOCKER_SCOPE = "__global__";

function dockerContainerScope(nodeId: string | null | undefined, search?: string) {
  const base = nodeId ?? GLOBAL_DOCKER_SCOPE;
  const q = search?.trim();
  return q ? `${base}:search:${q}` : base;
}

async function fetchAllNodes<T>(
  nodes: Node[],
  fetcher: (nodeId: string) => Promise<unknown>,
  normalizer: (data: unknown) => T[]
): Promise<T[]> {
  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const data = await fetcher(node.id);
      const items = normalizer(data);
      return tagWithNode(items, node.id, node.displayName || node.hostname);
    })
  );

  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason instanceof Error ? failed.reason : new Error("Failed to fetch Docker data");
  }

  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

const dockerRequestIds = {
  containers: 0,
  images: 0,
  volumes: 0,
  networks: 0,
  tasks: 0,
  registries: 0,
};

const initialLoading: Record<DockerResource, boolean> = {
  containers: false,
  images: false,
  volumes: false,
  networks: false,
  tasks: false,
  registries: false,
};

function loadingState(
  current: Record<DockerResource, boolean>,
  resource: DockerResource,
  value: boolean
) {
  const loading = { ...current, [resource]: value };
  return {
    loading,
    isLoading: Object.values(loading).some(Boolean),
  };
}

export const useDockerStore = create<DockerState>()((set, get) => ({
  containers: [],
  containersByScope: {},
  images: [],
  volumes: [],
  networks: [],
  tasks: [],
  registries: [],
  selectedNodeId: null,
  dockerNodes: [],
  dockerNodesLoaded: false,
  filters: { search: "", status: "all" },
  loading: initialLoading,
  isLoading: false,

  setSelectedNode: (nodeId) => {
    const scope = dockerContainerScope(nodeId);
    set((state) => ({
      selectedNodeId: nodeId,
      containers: state.containersByScope[scope] ?? [],
    }));
  },

  setDockerNodes: (nodes) =>
    set((state) => {
      const dockerNodes = nodes.filter(
        (n) => n.status === "online" && n.isConnected && !isNodeIncompatible(n)
      );
      return {
        dockerNodes,
        selectedNodeId: dockerNodes.some((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : null,
        dockerNodesLoaded: true,
      };
    }),

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
  },

  resetFilters: () => {
    set({ filters: { search: "", status: "all" } });
  },

  fetchContainers: async (nodeIdOverride, searchOverride, nodesOverride) => {
    const requestId = ++dockerRequestIds.containers;
    const { selectedNodeId, dockerNodes, filters } = get();
    const nodesForFetch = nodesOverride ?? dockerNodes;
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    const search = searchOverride ?? filters.search;
    const scope = dockerContainerScope(effectiveNodeId, search);
    const cached = get().containersByScope[scope];
    set((state) => ({
      containers: cached ?? [],
      ...loadingState(state.loading, "containers", !cached),
    }));
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerContainers(effectiveNodeId, { search });
        const node = nodesForFetch.find((n) => n.id === effectiveNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          effectiveNodeId,
          node?.displayName || node?.hostname || ""
        );
        if (requestId !== dockerRequestIds.containers) return;
        set((state) => ({
          containers: items,
          containersByScope: { ...state.containersByScope, [scope]: items },
          ...loadingState(state.loading, "containers", false),
        }));
      } else {
        const items = await fetchAllNodes(
          nodesForFetch,
          (nid) => api.listDockerContainers(nid, { search }),
          normList<DockerContainer>
        );
        if (requestId !== dockerRequestIds.containers) return;
        set((state) => ({
          containers: items,
          containersByScope: { ...state.containersByScope, [scope]: items },
          ...loadingState(state.loading, "containers", false),
        }));
      }
    } catch {
      if (requestId !== dockerRequestIds.containers) return;
      set((state) => loadingState(state.loading, "containers", false));
    }
  },

  forceFetchContainers: async (nodeIdOverride, searchOverride) => {
    const requestId = ++dockerRequestIds.containers;
    const { selectedNodeId, dockerNodes, filters } = get();
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    const search = searchOverride ?? filters.search;
    const scope = dockerContainerScope(effectiveNodeId, search);
    const cached = get().containersByScope[scope];
    set((state) => ({
      containers: cached ?? [],
      ...loadingState(state.loading, "containers", !cached),
    }));
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerContainers(effectiveNodeId, { noCache: true, search });
        const node = dockerNodes.find((n) => n.id === effectiveNodeId);
        const items = tagWithNode(
          normList<DockerContainer>(data),
          effectiveNodeId,
          node?.displayName || node?.hostname || ""
        );
        if (requestId !== dockerRequestIds.containers) return;
        set((state) => ({
          containers: items,
          containersByScope: { ...state.containersByScope, [scope]: items },
          ...loadingState(state.loading, "containers", false),
        }));
      } else {
        const items = await fetchAllNodes(
          dockerNodes,
          (nid) => api.listDockerContainers(nid, { noCache: true, search }),
          normList<DockerContainer>
        );
        if (requestId !== dockerRequestIds.containers) return;
        set((state) => ({
          containers: items,
          containersByScope: { ...state.containersByScope, [scope]: items },
          ...loadingState(state.loading, "containers", false),
        }));
      }
    } catch {
      if (requestId !== dockerRequestIds.containers) return;
      set((state) => loadingState(state.loading, "containers", false));
    }
  },

  fetchImages: async (nodeIdOverride, searchOverride, nodesOverride) => {
    const requestId = ++dockerRequestIds.images;
    const { selectedNodeId, dockerNodes, filters } = get();
    const nodesForFetch = nodesOverride ?? dockerNodes;
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    const search = searchOverride ?? filters.search;
    set((state) => loadingState(state.loading, "images", get().images.length === 0));
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerImages(effectiveNodeId, { search });
        const node = nodesForFetch.find((n) => n.id === effectiveNodeId);
        if (requestId !== dockerRequestIds.images) return;
        set((state) => ({
          images: tagWithNode(
            normList<DockerImage>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          ...loadingState(state.loading, "images", false),
        }));
      } else {
        const items = await fetchAllNodes(
          nodesForFetch,
          (nid) => api.listDockerImages(nid, { search }),
          normList<DockerImage>
        );
        if (requestId !== dockerRequestIds.images) return;
        set((state) => ({
          images: items,
          ...loadingState(state.loading, "images", false),
        }));
      }
    } catch {
      if (requestId !== dockerRequestIds.images) return;
      set((state) => loadingState(state.loading, "images", false));
    }
  },

  fetchVolumes: async (nodeIdOverride, searchOverride, nodesOverride) => {
    const requestId = ++dockerRequestIds.volumes;
    const { selectedNodeId, dockerNodes, filters } = get();
    const nodesForFetch = nodesOverride ?? dockerNodes;
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    const search = searchOverride ?? filters.search;
    set((state) => loadingState(state.loading, "volumes", get().volumes.length === 0));
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerVolumes(effectiveNodeId, { search });
        const node = nodesForFetch.find((n) => n.id === effectiveNodeId);
        if (requestId !== dockerRequestIds.volumes) return;
        set((state) => ({
          volumes: tagWithNode(
            normList<DockerVolume>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          ...loadingState(state.loading, "volumes", false),
        }));
      } else {
        const items = await fetchAllNodes(
          nodesForFetch,
          (nid) => api.listDockerVolumes(nid, { search }),
          normList<DockerVolume>
        );
        if (requestId !== dockerRequestIds.volumes) return;
        set((state) => ({
          volumes: items,
          ...loadingState(state.loading, "volumes", false),
        }));
      }
    } catch {
      if (requestId !== dockerRequestIds.volumes) return;
      set((state) => loadingState(state.loading, "volumes", false));
    }
  },

  fetchNetworks: async (nodeIdOverride, searchOverride, nodesOverride) => {
    const requestId = ++dockerRequestIds.networks;
    const { selectedNodeId, dockerNodes, filters } = get();
    const nodesForFetch = nodesOverride ?? dockerNodes;
    const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
    const search = searchOverride ?? filters.search;
    set((state) => loadingState(state.loading, "networks", get().networks.length === 0));
    try {
      if (effectiveNodeId) {
        const data = await api.listDockerNetworks(effectiveNodeId, { search });
        const node = nodesForFetch.find((n) => n.id === effectiveNodeId);
        if (requestId !== dockerRequestIds.networks) return;
        set((state) => ({
          networks: tagWithNode(
            normList<DockerNetwork>(data),
            effectiveNodeId,
            node?.displayName || node?.hostname || ""
          ),
          ...loadingState(state.loading, "networks", false),
        }));
      } else {
        const items = await fetchAllNodes(
          nodesForFetch,
          (nid) => api.listDockerNetworks(nid, { search }),
          normList<DockerNetwork>
        );
        if (requestId !== dockerRequestIds.networks) return;
        set((state) => ({
          networks: items,
          ...loadingState(state.loading, "networks", false),
        }));
      }
    } catch {
      if (requestId !== dockerRequestIds.networks) return;
      set((state) => loadingState(state.loading, "networks", false));
    }
  },

  fetchTasks: async (nodeIdOverride) => {
    const requestId = ++dockerRequestIds.tasks;
    set((state) => loadingState(state.loading, "tasks", get().tasks.length === 0));
    try {
      const { selectedNodeId } = get();
      const effectiveNodeId = nodeIdOverride ?? selectedNodeId;
      const data = await api.listDockerTasks(
        effectiveNodeId ? { nodeId: effectiveNodeId } : undefined
      );
      if (requestId !== dockerRequestIds.tasks) return;
      set((state) => ({
        tasks: data ?? [],
        ...loadingState(state.loading, "tasks", false),
      }));
    } catch {
      if (requestId !== dockerRequestIds.tasks) return;
      set((state) => loadingState(state.loading, "tasks", false));
    }
  },

  fetchRegistries: async () => {
    const requestId = ++dockerRequestIds.registries;
    set((state) => loadingState(state.loading, "registries", get().registries.length === 0));
    try {
      const data = await api.listDockerRegistries();
      if (requestId !== dockerRequestIds.registries) return;
      set((state) => ({
        registries: data ?? [],
        ...loadingState(state.loading, "registries", false),
      }));
    } catch {
      if (requestId !== dockerRequestIds.registries) return;
      set((state) => loadingState(state.loading, "registries", false));
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
