import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedNodesState {
  dashboardNodeIds: string[];
  sidebarNodeIds: string[];
  refreshTick: number;
  toggleDashboard: (nodeId: string) => void;
  toggleSidebar: (nodeId: string) => void;
  isPinnedDashboard: (nodeId: string) => boolean;
  isPinnedSidebar: (nodeId: string) => boolean;
  /** Trigger sidebar/dashboard refetch of pinned node data */
  invalidate: () => void;
}

export const usePinnedNodesStore = create<PinnedNodesState>()(
  persist(
    (set, get) => ({
      dashboardNodeIds: [],
      sidebarNodeIds: [],
      refreshTick: 0,

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
      invalidate: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
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
