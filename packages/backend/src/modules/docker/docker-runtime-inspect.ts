import type { ContainerRuntimeConfig } from './docker-runtime-limits.js';

export function applyRuntimeSettingsToInspect(
  inspect: Record<string, any>,
  config: ContainerRuntimeConfig | null
): Record<string, any> {
  if (!config) return inspect;
  const hostConfig = { ...(inspect.HostConfig ?? {}) } as Record<string, any>;

  if (config.restartPolicy) {
    hostConfig.RestartPolicy = {
      ...(hostConfig.RestartPolicy ?? {}),
      Name: config.restartPolicy,
      MaximumRetryCount: config.restartPolicy === 'on-failure' ? (config.maxRetries ?? 0) : 0,
    };
  }
  if (config.memoryLimit !== undefined) hostConfig.Memory = config.memoryLimit;
  if (config.memorySwap !== undefined) hostConfig.MemorySwap = config.memorySwap;
  if (config.nanoCPUs !== undefined) {
    hostConfig.NanoCPUs = config.nanoCPUs;
    if (config.nanoCPUs > 0) {
      hostConfig.CPUPeriod = 100000;
      hostConfig.CPUQuota = Math.round(config.nanoCPUs / 10000);
    } else {
      hostConfig.CPUPeriod = 0;
      hostConfig.CPUQuota = 0;
    }
  }
  if (config.cpuShares !== undefined) hostConfig.CpuShares = config.cpuShares;
  if (config.pidsLimit !== undefined) hostConfig.PidsLimit = config.pidsLimit;

  return { ...inspect, HostConfig: hostConfig };
}
