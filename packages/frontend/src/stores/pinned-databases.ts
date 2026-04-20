import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedDatabasesState {
  sidebarDatabaseIds: string[];
  databaseMeta: Record<string, { name: string; type: string; healthStatus?: string }>;
  refreshTick: number;
  toggleSidebar: (
    databaseId: string,
    meta?: { name: string; type: string; healthStatus?: string }
  ) => void;
  removePin: (databaseId: string) => void;
  isPinnedSidebar: (databaseId: string) => boolean;
  updateMeta: (
    databaseId: string,
    meta: { name: string; type: string; healthStatus?: string }
  ) => void;
  removeOrphans: (validIds: string[]) => void;
  invalidate: () => void;
}

export const usePinnedDatabasesStore = create<PinnedDatabasesState>()(
  persist(
    (set, get) => ({
      sidebarDatabaseIds: [],
      databaseMeta: {},
      refreshTick: 0,

      toggleSidebar: (databaseId, meta) =>
        set((s) => {
          const isSidebar = s.sidebarDatabaseIds.includes(databaseId);
          const newMeta = { ...s.databaseMeta };
          if (isSidebar) {
            delete newMeta[databaseId];
          } else if (meta) {
            newMeta[databaseId] = meta;
          }
          return {
            sidebarDatabaseIds: isSidebar
              ? s.sidebarDatabaseIds.filter((id) => id !== databaseId)
              : [...s.sidebarDatabaseIds, databaseId],
            databaseMeta: newMeta,
          };
        }),

      removePin: (databaseId) =>
        set((s) => {
          const newMeta = { ...s.databaseMeta };
          delete newMeta[databaseId];
          return {
            sidebarDatabaseIds: s.sidebarDatabaseIds.filter((id) => id !== databaseId),
            databaseMeta: newMeta,
          };
        }),

      isPinnedSidebar: (databaseId) => get().sidebarDatabaseIds.includes(databaseId),

      updateMeta: (databaseId, meta) =>
        set((s) => ({
          databaseMeta: { ...s.databaseMeta, [databaseId]: meta },
        })),

      removeOrphans: (validIds) =>
        set((s) => {
          const validSet = new Set(validIds);
          const newSide = s.sidebarDatabaseIds.filter((id) => validSet.has(id));
          const newMeta = { ...s.databaseMeta };
          for (const id of Object.keys(newMeta)) {
            if (!validSet.has(id)) delete newMeta[id];
          }
          if (newSide.length === s.sidebarDatabaseIds.length) return s;
          return {
            sidebarDatabaseIds: newSide,
            databaseMeta: newMeta,
          };
        }),

      invalidate: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
    }),
    {
      name: "gateway-pinned-databases",
      partialize: (s) => ({
        sidebarDatabaseIds: s.sidebarDatabaseIds,
        databaseMeta: s.databaseMeta,
      }),
    }
  )
);
