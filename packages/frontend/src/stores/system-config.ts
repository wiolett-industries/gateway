import { create } from "zustand";
import { api } from "@/services/api";
import type { GatewayFeatureConfig, SystemConfig } from "@/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const DEFAULT_GATEWAY_FEATURES: GatewayFeatureConfig = {
  pkiEnabled: true,
  domainsEnabled: true,
  loggingEnabled: false,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  fileUploadMaxBytes: 100 * BYTES_PER_MEGABYTE,
  fileOpenMaxBytes: 10 * BYTES_PER_MEGABYTE,
  gatewayPublicIps: [],
  gatewayGrpcPublicTarget: null,
  gatewayGrpcLocalIp: null,
  features: DEFAULT_GATEWAY_FEATURES,
};

const cachedSystemConfig = api.getCached<SystemConfig>("system:config");

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
  loaded: boolean;
  load: () => Promise<SystemConfig>;
  setConfig: (config: Partial<SystemConfig>) => void;
  reset: () => void;
}

export const useSystemConfigStore = create<SystemConfigState>((set) => ({
  config: withDefaultSystemConfig(cachedSystemConfig ?? null),
  isLoading: false,
  loaded: cachedSystemConfig !== undefined,
  load: async () => {
    set({ isLoading: true });
    try {
      const config = withDefaultSystemConfig(await api.getSystemConfig());
      api.setCache("system:config", config);
      set({ config, isLoading: false, loaded: true });
      return config;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },
  setConfig: (config) => {
    const next = withDefaultSystemConfig(config);
    api.setCache("system:config", next);
    set({ config: next, loaded: true });
  },
  reset: () => set({ config: DEFAULT_SYSTEM_CONFIG, isLoading: false, loaded: false }),
}));
