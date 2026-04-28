import { calculateRetryDelayMs, sleep } from './retry.js';
import type { GatewayTransport } from './transport.js';
import type { GatewayLogDropReason, GatewayRetryOptions, NormalizedGatewayLogEvent } from './types.js';

export interface GatewayLogQueueOptions {
  transport: GatewayTransport;
  maxBatchSize: number;
  flushIntervalMs: number;
  flushDebounceMs: number;
  maxQueueSize: number;
  overflow: 'drop-oldest' | 'drop-newest';
  retry: Required<GatewayRetryOptions>;
  onError?: (error: unknown) => void;
  onDrop?: (event: NormalizedGatewayLogEvent, reason: GatewayLogDropReason) => void;
}

export class GatewayLogQueue {
  private readonly events: NormalizedGatewayLogEvent[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;
  private flushInFlight: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: GatewayLogQueueOptions) {
    this.intervalTimer = setInterval(() => {
      void this.flush();
    }, options.flushIntervalMs);
    this.intervalTimer.unref?.();
  }

  enqueue(event: NormalizedGatewayLogEvent): void {
    if (this.closed) {
      this.options.onDrop?.(event, 'closed');
      return;
    }

    if (this.events.length >= this.options.maxQueueSize) {
      if (this.options.overflow === 'drop-oldest') {
        const dropped = this.events.shift();
        if (dropped) this.options.onDrop?.(dropped, 'queue_full');
      } else {
        this.options.onDrop?.(event, 'queue_full');
        return;
      }
    }

    this.events.push(event);

    if (this.events.length >= this.options.maxBatchSize) {
      this.scheduleFlush(0);
      return;
    }

    this.scheduleFlush(this.options.flushDebounceMs);
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.clearDebounceTimer();
    this.flushInFlight = this.flushLoop().finally(() => {
      this.flushInFlight = undefined;
    });
    return this.flushInFlight;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearDebounceTimer();
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = undefined;
    await this.flush();
  }

  private scheduleFlush(delayMs: number): void {
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, delayMs);
    this.debounceTimer.unref?.();
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }

  private async flushLoop(): Promise<void> {
    while (this.events.length > 0) {
      const batch = this.events.splice(0, this.options.maxBatchSize);
      await this.sendWithRetry(batch);
    }
  }

  private async sendWithRetry(batch: NormalizedGatewayLogEvent[]): Promise<void> {
    for (let attempt = 1; attempt <= this.options.retry.maxAttempts; attempt += 1) {
      const result = await this.options.transport.send(batch);
      if (result.ok) return;

      if (!result.retryable) {
        this.dropBatch(batch, 'permanent_failure');
        this.options.onError?.(result.error);
        return;
      }

      if (attempt >= this.options.retry.maxAttempts) {
        this.dropBatch(batch, 'retry_exhausted');
        this.options.onError?.(result.error);
        return;
      }

      const delayMs =
        result.retryAfterMs ??
        calculateRetryDelayMs({
          attempt,
          minDelayMs: this.options.retry.minDelayMs,
          maxDelayMs: this.options.retry.maxDelayMs,
          jitter: this.options.retry.jitter,
        });
      await sleep(delayMs);
    }
  }

  private dropBatch(batch: NormalizedGatewayLogEvent[], reason: GatewayLogDropReason): void {
    for (const event of batch) this.options.onDrop?.(event, reason);
  }
}
