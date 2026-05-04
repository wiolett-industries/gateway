import { create } from "zustand";
import { persist } from "zustand/middleware";

export const APP_STATUS_STORAGE_KEY = "gateway-app-status";

interface AppStatusState {
  maintenanceActive: boolean;
  gatewayUpdatingActive: boolean;
  gatewayUpdatingTargetVersion: string | null;
  gatewayUpdateError: { message: string; targetVersion: string | null } | null;
  rateLimitedUntil: number | null;
  setMaintenanceActive: (active: boolean) => void;
  setGatewayUpdatingActive: (active: boolean, targetVersion?: string | null) => void;
  setGatewayUpdateError: (message: string, targetVersion?: string | null) => void;
  clearGatewayUpdating: () => void;
  clearGatewayUpdateError: () => void;
  activateRateLimit: (seconds?: number) => void;
  clearRateLimit: () => void;
}

export const useAppStatusStore = create<AppStatusState>()(
  persist(
    (set) => ({
      maintenanceActive: false,
      gatewayUpdatingActive: false,
      gatewayUpdatingTargetVersion: null,
      gatewayUpdateError: null,
      rateLimitedUntil: null,

      setMaintenanceActive: (maintenanceActive) => set({ maintenanceActive }),

      setGatewayUpdatingActive: (gatewayUpdatingActive, gatewayUpdatingTargetVersion = null) =>
        set({ gatewayUpdatingActive, gatewayUpdatingTargetVersion, gatewayUpdateError: null }),

      setGatewayUpdateError: (message, targetVersion = null) =>
        set({
          gatewayUpdatingActive: false,
          gatewayUpdatingTargetVersion: null,
          gatewayUpdateError: { message, targetVersion },
        }),

      clearGatewayUpdating: () =>
        set({ gatewayUpdatingActive: false, gatewayUpdatingTargetVersion: null }),

      clearGatewayUpdateError: () => set({ gatewayUpdateError: null }),

      activateRateLimit: (seconds = 60) =>
        set({
          rateLimitedUntil: Date.now() + Math.max(1, seconds) * 1000,
        }),

      clearRateLimit: () => set({ rateLimitedUntil: null }),
    }),
    {
      name: APP_STATUS_STORAGE_KEY,
      partialize: (state) => ({
        gatewayUpdatingActive: state.gatewayUpdatingActive,
        gatewayUpdatingTargetVersion: state.gatewayUpdatingTargetVersion,
      }),
    }
  )
);
