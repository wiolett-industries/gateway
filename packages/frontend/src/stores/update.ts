import { create } from "zustand";
import { api } from "@/services/api";
import type { UpdateStatus } from "@/types";

interface UpdateState {
  status: UpdateStatus | null;
  isChecking: boolean;
  isUpdating: boolean;

  fetchStatus: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  triggerUpdate: (version: string) => Promise<void>;
  clearUpdating: () => void;
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: null,
  isChecking: false,
  isUpdating: false,

  fetchStatus: async () => {
    try {
      const status = await api.getVersionInfo();
      api.setCache("system:version", status);
      set({ status });
    } catch {
      // ignore
    }
  },

  checkForUpdates: async () => {
    set({ isChecking: true });
    try {
      const status = await api.checkForUpdates();
      api.setCache("system:version", status);
      set({ status });
    } catch {
      // ignore
    } finally {
      set({ isChecking: false });
    }
  },

  triggerUpdate: async (version: string) => {
    set({ isUpdating: true });
    try {
      await api.triggerUpdate(version);
      // Poll for completion
      const currentVersion = get().status?.currentVersion;
      const poll = setInterval(async () => {
        try {
          const status = await api.getVersionInfo();
          if (status.currentVersion !== currentVersion) {
            clearInterval(poll);
            window.location.href = window.location.pathname + "?_v=" + Date.now();
          }
        } catch {
          // App still down
        }
      }, 3000);
      // Safety timeout
      setTimeout(() => {
        clearInterval(poll);
        set((s) => {
          if (s.isUpdating) return { isUpdating: false };
          return s;
        });
      }, 300_000);
    } catch {
      set({ isUpdating: false });
    }
  },

  clearUpdating: () => set({ isUpdating: false }),
}));
