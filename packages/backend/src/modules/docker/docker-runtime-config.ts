import type { ContainerRuntimeConfig } from './docker-runtime-limits.js';

export function extractRuntimeConfig(config: Record<string, unknown>): ContainerRuntimeConfig {
  return {
    restartPolicy:
      typeof config.restartPolicy === 'string'
        ? (config.restartPolicy as ContainerRuntimeConfig['restartPolicy'])
        : undefined,
    maxRetries: typeof config.maxRetries === 'number' ? config.maxRetries : undefined,
    memoryLimit: typeof config.memoryLimit === 'number' ? config.memoryLimit : undefined,
    memorySwap: typeof config.memorySwap === 'number' ? config.memorySwap : undefined,
    nanoCPUs: typeof config.nanoCPUs === 'number' ? config.nanoCPUs : undefined,
    cpuShares: typeof config.cpuShares === 'number' ? config.cpuShares : undefined,
    pidsLimit: typeof config.pidsLimit === 'number' ? config.pidsLimit : undefined,
  };
}

export function normalizeRuntimeConfig(config: ContainerRuntimeConfig): ContainerRuntimeConfig {
  const normalized: ContainerRuntimeConfig = {};
  if (config.restartPolicy && config.restartPolicy !== 'no') {
    normalized.restartPolicy = config.restartPolicy;
  }
  if ((config.maxRetries ?? 0) > 0) {
    normalized.maxRetries = config.maxRetries;
  }
  if ((config.memoryLimit ?? 0) > 0) {
    normalized.memoryLimit = config.memoryLimit;
  }
  if (config.memorySwap === -1 || (config.memorySwap ?? 0) > 0) {
    normalized.memorySwap = config.memorySwap;
  }
  if ((config.nanoCPUs ?? 0) > 0) {
    normalized.nanoCPUs = config.nanoCPUs;
  }
  if ((config.cpuShares ?? 0) > 0) {
    normalized.cpuShares = config.cpuShares;
  }
  if ((config.pidsLimit ?? 0) > 0) {
    normalized.pidsLimit = config.pidsLimit;
  }
  return normalized;
}

export function mergeRuntimeConfig(
  base: ContainerRuntimeConfig,
  patch: ContainerRuntimeConfig
): ContainerRuntimeConfig {
  return normalizeRuntimeConfig({
    restartPolicy: patch.restartPolicy ?? base.restartPolicy,
    maxRetries: patch.maxRetries ?? base.maxRetries,
    memoryLimit: patch.memoryLimit ?? base.memoryLimit,
    memorySwap: patch.memorySwap ?? base.memorySwap,
    nanoCPUs: patch.nanoCPUs ?? base.nanoCPUs,
    cpuShares: patch.cpuShares ?? base.cpuShares,
    pidsLimit: patch.pidsLimit ?? base.pidsLimit,
  });
}
