import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedContainersState {
  dashboardContainerIds: string[];
  sidebarContainerIds: string[];
  /** Maps containerId → { nodeId, name, state } for sidebar display */
  containerMeta: Record<string, { nodeId: string; name: string; state?: string }>;
  refreshTick: number;
  toggleDashboard: (containerId: string) => void;
  toggleSidebar: (containerId: string, meta?: { nodeId: string; name: string; state?: string }) => void;
  isPinnedDashboard: (containerId: string) => boolean;
  isPinnedSidebar: (containerId: string) => boolean;
  /** Update display name / state (e.g. after rename or status change) */
  updateMeta: (containerId: string, meta: { nodeId: string; name: string; state?: string }) => void;
  invalidate: () => void;
}

export const usePinnedContainersStore = create<PinnedContainersState>()(
  persist(
    (set, get) => ({
      dashboardContainerIds: [],
      sidebarContainerIds: [],
      containerMeta: {},
      refreshTick: 0,

      toggleDashboard: (containerId) =>
        set((s) => ({
          dashboardContainerIds: s.dashboardContainerIds.includes(containerId)
            ? s.dashboardContainerIds.filter((id) => id !== containerId)
            : [...s.dashboardContainerIds, containerId],
        })),

      toggleSidebar: (containerId, meta) =>
        set((s) => {
          const isSidebar = s.sidebarContainerIds.includes(containerId);
          const newMeta = { ...s.containerMeta };
          if (isSidebar) {
            delete newMeta[containerId];
          } else if (meta) {
            newMeta[containerId] = meta;
          }
          return {
            sidebarContainerIds: isSidebar
              ? s.sidebarContainerIds.filter((id) => id !== containerId)
              : [...s.sidebarContainerIds, containerId],
            containerMeta: newMeta,
          };
        }),

      isPinnedDashboard: (containerId) => get().dashboardContainerIds.includes(containerId),
      isPinnedSidebar: (containerId) => get().sidebarContainerIds.includes(containerId),

      updateMeta: (containerId, meta) =>
        set((s) => ({
          containerMeta: { ...s.containerMeta, [containerId]: meta },
        })),

      invalidate: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
    }),
    {
      name: "gateway-pinned-containers",
      partialize: (s) => ({
        dashboardContainerIds: s.dashboardContainerIds,
        sidebarContainerIds: s.sidebarContainerIds,
        containerMeta: s.containerMeta,
      }),
    }
  )
);
