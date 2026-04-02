import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedProxiesState {
  dashboardProxyIds: string[];
  sidebarProxyIds: string[];
  refreshTick: number;
  toggleDashboard: (proxyId: string) => void;
  toggleSidebar: (proxyId: string) => void;
  isPinnedDashboard: (proxyId: string) => boolean;
  isPinnedSidebar: (proxyId: string) => boolean;
  invalidate: () => void;
}

export const usePinnedProxiesStore = create<PinnedProxiesState>()(
  persist(
    (set, get) => ({
      dashboardProxyIds: [],
      sidebarProxyIds: [],
      refreshTick: 0,

      toggleDashboard: (proxyId) =>
        set((s) => ({
          dashboardProxyIds: s.dashboardProxyIds.includes(proxyId)
            ? s.dashboardProxyIds.filter((id) => id !== proxyId)
            : [...s.dashboardProxyIds, proxyId],
        })),

      toggleSidebar: (proxyId) =>
        set((s) => ({
          sidebarProxyIds: s.sidebarProxyIds.includes(proxyId)
            ? s.sidebarProxyIds.filter((id) => id !== proxyId)
            : [...s.sidebarProxyIds, proxyId],
        })),

      isPinnedDashboard: (proxyId) => get().dashboardProxyIds.includes(proxyId),
      isPinnedSidebar: (proxyId) => get().sidebarProxyIds.includes(proxyId),
      invalidate: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
    }),
    {
      name: "gateway-pinned-proxy-hosts",
      partialize: (s) => ({
        dashboardProxyIds: s.dashboardProxyIds,
        sidebarProxyIds: s.sidebarProxyIds,
      }),
    }
  )
);
