import { create } from "zustand";

interface AppStatusState {
  maintenanceActive: boolean;
  gatewayUpdatingActive: boolean;
  gatewayUpdatingTargetVersion: string | null;
  rateLimitedUntil: number | null;
  setMaintenanceActive: (active: boolean) => void;
  setGatewayUpdatingActive: (active: boolean, targetVersion?: string | null) => void;
  clearGatewayUpdating: () => void;
  activateRateLimit: (seconds?: number) => void;
  clearRateLimit: () => void;
}

export const useAppStatusStore = create<AppStatusState>()((set) => ({
  maintenanceActive: false,
  gatewayUpdatingActive: false,
  gatewayUpdatingTargetVersion: null,
  rateLimitedUntil: null,

  setMaintenanceActive: (maintenanceActive) => set({ maintenanceActive }),

  setGatewayUpdatingActive: (gatewayUpdatingActive, gatewayUpdatingTargetVersion = null) =>
    set({ gatewayUpdatingActive, gatewayUpdatingTargetVersion }),

  clearGatewayUpdating: () =>
    set({ gatewayUpdatingActive: false, gatewayUpdatingTargetVersion: null }),

  activateRateLimit: (seconds = 60) =>
    set({
      rateLimitedUntil: Date.now() + Math.max(1, seconds) * 1000,
    }),

  clearRateLimit: () => set({ rateLimitedUntil: null }),
}));
