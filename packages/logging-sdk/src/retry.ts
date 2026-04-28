export interface RetryDelayInput {
  attempt: number;
  minDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export function calculateRetryDelayMs(input: RetryDelayInput): number {
  const exponent = Math.max(0, input.attempt - 1);
  const baseDelay = Math.min(input.maxDelayMs, input.minDelayMs * 2 ** exponent);
  if (!input.jitter) return baseDelay;
  return Math.floor(baseDelay * (0.5 + Math.random() * 0.5));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
