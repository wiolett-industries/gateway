import { describe, expect, it, vi } from 'vitest';
import { GatewayLogQueue } from './queue.js';
import type { GatewayTransport } from './transport.js';
import type { NormalizedGatewayLogEvent } from './types.js';

const event = (message: string): NormalizedGatewayLogEvent => ({ severity: 'info', message });

describe('gateway log queue', () => {
  it('debounces automatic sends instead of sending on every log', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ ok: true, accepted: 3, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    queue.enqueue(event('three'));

    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([event('one'), event('two'), event('three')]);

    await queue.close();
    vi.useRealTimers();
  });

  it('flushes immediately when max batch size is reached', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ ok: true, accepted: 2, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 2,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledWith([event('one'), event('two')]);
    await queue.close();
    vi.useRealTimers();
  });

  it('backs off when rate limited and retries the same batch', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, retryable: true, rateLimited: true, retryAfterMs: 1000, status: 429 })
      .mockResolvedValueOnce({ ok: true, accepted: 1, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 10,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    await vi.advanceTimersByTimeAsync(10);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await queue.close();
    vi.useRealTimers();
  });

  it('drops oldest event when queue is full', () => {
    const onDrop = vi.fn();
    const queue = new GatewayLogQueue({
      transport: { send: vi.fn() } as unknown as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 2,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
      onDrop,
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    queue.enqueue(event('three'));

    expect(onDrop).toHaveBeenCalledWith(event('one'), 'queue_full');
  });

  it('drops later logs after close', async () => {
    const onDrop = vi.fn();
    const queue = new GatewayLogQueue({
      transport: { send: vi.fn().mockResolvedValue({ ok: true, accepted: 0, rejected: 0 }) } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 2,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
      onDrop,
    });

    await queue.close();
    queue.enqueue(event('after close'));

    expect(onDrop).toHaveBeenCalledWith(event('after close'), 'closed');
  });

  it('passes failed logs to drop, error, and fallback callbacks when delivery permanently fails', async () => {
    const error = { code: 'INVALID_BODY' };
    const logs = [event('one'), event('two')];
    const onDrop = vi.fn();
    const onError = vi.fn();
    const onFallback = vi.fn();
    const queue = new GatewayLogQueue({
      transport: {
        send: vi.fn().mockResolvedValue({ ok: false, retryable: false, rateLimited: false, status: 400, error }),
      } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
      onDrop,
      onError,
      onFallback,
    });

    queue.enqueue(logs[0]);
    queue.enqueue(logs[1]);
    await queue.flush();

    expect(onDrop).toHaveBeenNthCalledWith(1, logs[0], 'permanent_failure');
    expect(onDrop).toHaveBeenNthCalledWith(2, logs[1], 'permanent_failure');
    expect(onError).toHaveBeenCalledWith(error, logs, {
      reason: 'permanent_failure',
      error,
      status: 400,
    });
    expect(onFallback).toHaveBeenCalledWith(logs, {
      reason: 'permanent_failure',
      error,
      status: 400,
    });
    await queue.close();
  });
});
