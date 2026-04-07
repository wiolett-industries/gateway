import { EventEmitter } from 'node:events';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('EventBus');

/**
 * In-process realtime event bus.
 *
 * Designed with the same shape as a future Redis pub/sub interface so that
 * swapping the backing store later (for horizontal scaling) is mechanical.
 *
 * Channel naming: dotted strings, e.g. `docker.container.changed`,
 * `permissions.changed.<userId>`. Subscribers may subscribe to a literal
 * channel name only — no wildcards (kept simple to match Redis pub/sub).
 */
export class EventBusService {
  private emitter = new EventEmitter();

  constructor() {
    // Each connection gets its own listener; bump the cap so we don't see
    // spurious "MaxListenersExceededWarning" with many concurrent clients.
    this.emitter.setMaxListeners(0);
  }

  publish(channel: string, payload: unknown): void {
    try {
      this.emitter.emit(channel, payload);
    } catch (err) {
      logger.error('event publish failed', { channel, error: err });
    }
  }

  /**
   * Subscribe to a channel. Returns an unsubscribe function. Always call
   * the returned function on connection close to avoid leaks.
   */
  subscribe(channel: string, fn: (payload: unknown) => void): () => void {
    this.emitter.on(channel, fn);
    return () => {
      this.emitter.off(channel, fn);
    };
  }
}
