import { describe, expect, it, vi } from 'vitest';
import { calculateRetryDelayMs, sleep } from './retry.js';

describe('retry helpers', () => {
  it('uses exponential backoff capped by max delay', () => {
    expect(calculateRetryDelayMs({ attempt: 1, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(500);
    expect(calculateRetryDelayMs({ attempt: 3, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(2000);
    expect(calculateRetryDelayMs({ attempt: 10, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(30_000);
  });

  it('sleeps for the requested delay', async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
