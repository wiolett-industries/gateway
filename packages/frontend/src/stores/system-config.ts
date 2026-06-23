import { create } from "zustand";
import { api } from "@/services/api";
import type { GatewayFeatureConfig, SystemConfig } from "@/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const DEFAULT_GATEWAY_FEATURES: GatewayFeatureConfig = {
  pkiEnabled: true,
  domainsEnabled: true,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  fileUploadMaxBytes: 100 * BYTES_PER_MEGABYTE,
  fileOpenMaxBytes: 10 * BYTES_PER_MEGABYTE,
  features: DEFAULT_GATEWAY_FEATURES,
};

export function withDefaultSystemConfig(
  config: Partial<SystemConfig> | null | undefined
): SystemConfig {
  return {
    ...DEFAULT_SYSTEM_CONFIG,
    ...config,
    features: {
      ...DEFAULT_GATEWAY_FEATURES,
      ...config?.features,
    },
  };
}

interface SystemConfigState {
  config: SystemConfig;
  isLoading: boolean;
  load: () => Promise<SystemConfig>;
  setConfig: (config: Partial<SystemConfig>) => void;
  reset: () => void;
}

export const useSystemConfigStore = create<SystemConfigState>((set) => ({
  config: withDefaultSystemConfig(api.getCached<SystemConfig>("system:config") ?? null),
  isLoading: false,
  load: async () => {
    set({ isLoading: true });
    try {
      const config = withDefaultSystemConfig(await api.getSystemConfig());
      api.setCache("system:config", config);
      set({ config, isLoading: false });
      return config;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },
  setConfig: (config) => {
    const next = withDefaultSystemConfig(config);
    api.setCache("system:config", next);
    set({ config: next });
  },
  reset: () => set({ config: DEFAULT_SYSTEM_CONFIG, isLoading: false }),
}));
