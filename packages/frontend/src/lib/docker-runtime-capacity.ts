import { api } from "@/services/api";
import type { Node, NodeDetail, NodeHealthReport } from "@/types";

export type DockerRuntimeCapacity = {
  maxCpuCount: number | null;
  maxMemoryBytes: number | null;
  maxSwapBytes: number | null;
};

export const UNKNOWN_DOCKER_RUNTIME_CAPACITY: DockerRuntimeCapacity = {
  maxCpuCount: null,
  maxMemoryBytes: null,
  maxSwapBytes: null,
};

function normalizePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function deriveDockerRuntimeCapacity(
  node: Node | NodeDetail | null | undefined
): DockerRuntimeCapacity {
  const caps = (node?.capabilities ?? {}) as Record<string, unknown>;
  const health = ((node as NodeDetail | undefined)?.liveHealthReport ??
    node?.lastHealthReport ??
    null) as NodeHealthReport | null;

  return {
    maxCpuCount: normalizePositiveNumber(caps.cpuCores),
    maxMemoryBytes: normalizePositiveNumber(health?.systemMemoryTotalBytes),
    maxSwapBytes: normalizeNonNegativeNumber(health?.swapTotalBytes),
  };
}

export async function loadDockerRuntimeCapacity(nodeId: string): Promise<DockerRuntimeCapacity> {
  try {
    return deriveDockerRuntimeCapacity(await api.getNode(nodeId));
  } catch {
    try {
      const nodes = await api.listNodes({ type: "docker", limit: 100 });
      const node = nodes.data.find((candidate) => candidate.id === nodeId);
      return deriveDockerRuntimeCapacity(node);
    } catch {
      return UNKNOWN_DOCKER_RUNTIME_CAPACITY;
    }
  }
}
