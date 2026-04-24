import { AppError } from '@/middleware/error-handler.js';

export interface NodeRuntimeCapacity {
  cpuCores: number | null;
  memoryBytes: number | null;
  swapBytes: number | null;
}

export interface ContainerRuntimeConfig {
  memoryLimit?: number;
  memorySwap?: number;
  nanoCPUs?: number;
  cpuQuota?: number;
  cpuPeriod?: number;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

export function validateContainerRuntimeLimits(
  next: ContainerRuntimeConfig,
  current: ContainerRuntimeConfig,
  capacity: NodeRuntimeCapacity
) {
  const deriveNanoCPUs = (config: ContainerRuntimeConfig) => {
    if ((config.nanoCPUs ?? 0) > 0) return config.nanoCPUs ?? 0;
    if ((config.cpuQuota ?? 0) > 0 && (config.cpuPeriod ?? 0) > 0) {
      return Math.round(((config.cpuQuota ?? 0) / (config.cpuPeriod ?? 1)) * 1e9);
    }
    return 0;
  };

  const touchesCpu = next.nanoCPUs !== undefined;
  const touchesMemory = next.memoryLimit !== undefined;
  const touchesSwap = next.memorySwap !== undefined;
  const effectiveMemoryLimit = next.memoryLimit ?? current.memoryLimit ?? 0;
  const effectiveMemorySwap = next.memorySwap ?? current.memorySwap ?? 0;
  const effectiveNanoCPUs = deriveNanoCPUs(next) || deriveNanoCPUs(current);

  if (touchesCpu && capacity.cpuCores && effectiveNanoCPUs > capacity.cpuCores * 1e9) {
    throw new AppError(
      400,
      'INVALID_RESOURCE_LIMIT',
      `CPU limit cannot exceed node CPU capacity (${capacity.cpuCores} cores)`
    );
  }

  if ((touchesMemory || touchesSwap) && capacity.memoryBytes && effectiveMemoryLimit > capacity.memoryBytes) {
    throw new AppError(
      400,
      'INVALID_RESOURCE_LIMIT',
      `Memory limit cannot exceed node memory (${formatBytes(capacity.memoryBytes)})`
    );
  }

  if (!(touchesMemory || touchesSwap)) {
    return;
  }

  if (effectiveMemoryLimit <= 0 && effectiveMemorySwap !== 0) {
    throw new AppError(400, 'INVALID_RESOURCE_LIMIT', 'Set a memory limit before configuring swap');
  }

  if (effectiveMemorySwap !== -1 && effectiveMemorySwap > 0) {
    if (effectiveMemorySwap < effectiveMemoryLimit) {
      throw new AppError(
        400,
        'INVALID_RESOURCE_LIMIT',
        'Memory+swap limit cannot be lower than the memory limit'
      );
    }

    const maxCombinedMemoryAndSwap =
      (capacity.memoryBytes ?? 0) + Math.max(capacity.swapBytes ?? 0, 0);
    if (maxCombinedMemoryAndSwap > 0 && effectiveMemorySwap > maxCombinedMemoryAndSwap) {
      throw new AppError(
        400,
        'INVALID_RESOURCE_LIMIT',
        `Memory+swap limit cannot exceed node memory+swap (${formatBytes(maxCombinedMemoryAndSwap)})`
      );
    }
  }
}
