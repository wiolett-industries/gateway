import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedNodesState {
  dashboardNodeIds: string[];
  sidebarNodeIds: string[];
  toggleDashboard: (nodeId: string) => void;
  toggleSidebar: (nodeId: string) => void;
  isPinnedDashboard: (nodeId: string) => boolean;
  isPinnedSidebar: (nodeId: string) => boolean;
}

export const usePinnedNodesStore = create<PinnedNodesState>()(
  persist(
    (set, get) => ({
      dashboardNodeIds: [],
      sidebarNodeIds: [],

      toggleDashboard: (nodeId) =>
        set((s) => ({
          dashboardNodeIds: s.dashboardNodeIds.includes(nodeId)
            ? s.dashboardNodeIds.filter((id) => id !== nodeId)
            : [...s.dashboardNodeIds, nodeId],
        })),

      toggleSidebar: (nodeId) =>
        set((s) => ({
          sidebarNodeIds: s.sidebarNodeIds.includes(nodeId)
            ? s.sidebarNodeIds.filter((id) => id !== nodeId)
            : [...s.sidebarNodeIds, nodeId],
        })),

      isPinnedDashboard: (nodeId) => get().dashboardNodeIds.includes(nodeId),
      isPinnedSidebar: (nodeId) => get().sidebarNodeIds.includes(nodeId),
    }),
    {
      name: "gateway-pinned-nodes",
      partialize: (s) => ({
        dashboardNodeIds: s.dashboardNodeIds,
        sidebarNodeIds: s.sidebarNodeIds,
      }),
    }
  )
);
