export interface RuntimeFormValues {
  restartPolicy: string;
  maxRetries: string;
  memoryMB: string;
  memSwapMB: string;
  cpuCount: string;
  cpuShares: string;
  pidsLimit: string;
}

function toNumber(value: string): number {
  return value.trim() ? Number(value) : 0;
}

function toMemoryBytes(value: string): number {
  return value.trim() ? Number(value) * 1048576 : 0;
}

function toNanoCPUs(value: string): number {
  return value.trim() ? Math.round(Number(value) * 1e9) : 0;
}

function toCombinedMemorySwapBytes(memoryBytes: number, swapMB: string): number {
  const swapOnly = swapMB === "-1" ? -1 : toMemoryBytes(swapMB);
  return swapOnly === -1 ? -1 : memoryBytes > 0 ? memoryBytes + Math.max(0, swapOnly) : 0;
}

export function buildRuntimePayloadFromForm(
  current: RuntimeFormValues,
  baseline: RuntimeFormValues
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};

  if (current.restartPolicy !== baseline.restartPolicy) {
    payload.restartPolicy = current.restartPolicy;
  }

  if (
    current.restartPolicy === "on-failure" &&
    toNumber(current.maxRetries) !== toNumber(baseline.maxRetries)
  ) {
    payload.maxRetries = toNumber(current.maxRetries);
  }

  const currentMemoryBytes = toMemoryBytes(current.memoryMB);
  const baselineMemoryBytes = toMemoryBytes(baseline.memoryMB);
  const currentMemorySwapBytes = toCombinedMemorySwapBytes(currentMemoryBytes, current.memSwapMB);
  const baselineMemorySwapBytes = toCombinedMemorySwapBytes(
    baselineMemoryBytes,
    baseline.memSwapMB
  );

  if (
    currentMemoryBytes !== baselineMemoryBytes ||
    currentMemorySwapBytes !== baselineMemorySwapBytes
  ) {
    payload.memoryLimit = currentMemoryBytes;
    payload.memorySwap = currentMemorySwapBytes;
  }

  const currentNanoCPUs = toNanoCPUs(current.cpuCount);
  if (currentNanoCPUs !== toNanoCPUs(baseline.cpuCount)) {
    payload.nanoCPUs = currentNanoCPUs;
  }

  const currentCpuShares = toNumber(current.cpuShares);
  if (currentCpuShares !== toNumber(baseline.cpuShares)) {
    payload.cpuShares = currentCpuShares;
  }

  const currentPidsLimit = toNumber(current.pidsLimit);
  if (currentPidsLimit !== toNumber(baseline.pidsLimit)) {
    payload.pidsLimit = currentPidsLimit;
  }

  if (Object.keys(payload).length === 0) {
    return null;
  }

  if (!("restartPolicy" in payload)) {
    payload.restartPolicy = current.restartPolicy;
  }

  return payload;
}
