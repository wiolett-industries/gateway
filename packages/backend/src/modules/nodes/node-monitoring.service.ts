import { EventEmitter } from 'node:events';
import { createChildLogger } from '@/lib/logger.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';

const logger = createChildLogger('NodeMonitoring');

interface MonitoringSnapshot {
  timestamp: string;
  health: any;
  stats: any;
  traffic: any;
}

export class NodeMonitoringService extends EventEmitter {
  private history = new Map<string, MonitoringSnapshot[]>();
  private clientCounts = new Map<string, number>();
  private pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly MAX_HISTORY = 60;

  constructor(
    private registry: NodeRegistryService,
    private dispatch: NodeDispatchService
  ) {
    super();
    this.setMaxListeners(100);
  }

  getHistory(nodeId: string): MonitoringSnapshot[] {
    return [...(this.history.get(nodeId) ?? [])];
  }

  pushSnapshot(nodeId: string, health: any, stats: any, traffic?: any): void {
    const snapshot: MonitoringSnapshot = {
      timestamp: new Date().toISOString(),
      health,
      stats,
      traffic: traffic ?? null,
    };
    let buf = this.history.get(nodeId);
    if (!buf) {
      buf = [];
      this.history.set(nodeId, buf);
    }
    buf.push(snapshot);
    if (buf.length > this.MAX_HISTORY) buf.splice(0, buf.length - this.MAX_HISTORY);
    this.emit('snapshot', { nodeId, snapshot });
  }

  registerClient(nodeId: string): void {
    const count = (this.clientCounts.get(nodeId) ?? 0) + 1;
    this.clientCounts.set(nodeId, count);
    if (count === 1) this.startPolling(nodeId);
  }

  unregisterClient(nodeId: string): void {
    const count = Math.max(0, (this.clientCounts.get(nodeId) ?? 0) - 1);
    this.clientCounts.set(nodeId, count);
    if (count === 0) this.stopPolling(nodeId);
  }

  private startPolling(nodeId: string): void {
    if (this.pollIntervals.has(nodeId)) return;
    logger.debug('Starting 5s polling for node', { nodeId });

    const poll = async () => {
      try {
        const node = this.registry.getNode(nodeId);
        if (!node) return;

        // RequestHealth and RequestStats are handled inline by the daemon —
        // they return HealthReport/StatsReport messages (not CommandResult).
        // Fire-and-forget via the stream, wait, then read from registry.
        try {
          node.commandStream.write({ commandId: '', requestHealth: {} }, (err: any) => {
            if (err) logger.debug('Health poll write failed', { nodeId, error: err.message });
          });
          node.commandStream.write({ commandId: '', requestStats: {} }, (err: any) => {
            if (err) logger.debug('Stats poll write failed', { nodeId, error: err.message });
          });
        } catch {
          // Stream may be closed
        }

        // Wait for daemon to respond and control.ts to update the registry
        await new Promise((r) => setTimeout(r, 1000));

        const health = node.lastHealthReport;
        const stats = node.lastStatsReport;
        if (health) {
          // Request traffic stats via fire-and-forget (result arrives as CommandResult
          // and is stored in node.lastTrafficStats by control.ts)
          try {
            node.commandStream.write(
              { commandId: `traffic-${Date.now()}`, requestTrafficStats: { tailLines: 200 } },
              (err: any) => {
                if (err) logger.debug('Traffic stats write failed', { nodeId, error: err.message });
              }
            );
          } catch {
            // Stream may be closed
          }
          const traffic = node.lastTrafficStats ?? null;
          this.pushSnapshot(nodeId, health, stats, traffic);
        }
      } catch (err) {
        logger.debug('Polling error', { nodeId, error: (err as Error).message });
      }
    };

    // First poll immediately
    poll();
    this.pollIntervals.set(nodeId, setInterval(poll, 5000));
  }

  private stopPolling(nodeId: string): void {
    const interval = this.pollIntervals.get(nodeId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(nodeId);
      logger.debug('Stopped polling for node', { nodeId });
    }
  }

  destroy(): void {
    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
  }
}
