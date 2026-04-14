import { create } from "zustand";

interface AppStatusState {
  maintenanceActive: boolean;
  rateLimitedUntil: number | null;
  setMaintenanceActive: (active: boolean) => void;
  activateRateLimit: (seconds?: number) => void;
  clearRateLimit: () => void;
}

export const useAppStatusStore = create<AppStatusState>()((set) => ({
  maintenanceActive: false,
  rateLimitedUntil: null,

  setMaintenanceActive: (maintenanceActive) => set({ maintenanceActive }),

  activateRateLimit: (seconds = 60) =>
    set({
      rateLimitedUntil: Date.now() + Math.max(1, seconds) * 1000,
    }),

  clearRateLimit: () => set({ rateLimitedUntil: null }),
}));
