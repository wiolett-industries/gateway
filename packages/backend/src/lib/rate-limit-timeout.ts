export const RATE_LIMIT_REDIS_TIMEOUT_MS = 1000;

export async function withRateLimitRedisTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Redis rate-limit operation timed out')),
          RATE_LIMIT_REDIS_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
