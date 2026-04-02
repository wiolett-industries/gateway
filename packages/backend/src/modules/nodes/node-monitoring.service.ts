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
  private backgroundInterval: ReturnType<typeof setInterval> | null = null;
  private readonly MAX_HISTORY = 60;
  private readonly BACKGROUND_POLL_INTERVAL = 10_000; // 10s background, 5s when client connected

  constructor(
    private registry: NodeRegistryService,
    private dispatch: NodeDispatchService
  ) {
    super();
    this.setMaxListeners(100);
    this.startBackgroundPolling();
  }

  /**
   * Background polling: collect health/stats for ALL connected nodes every 10s.
   * This ensures history is pre-populated before a user opens the monitoring page.
   * When a client connects, their node switches to 5s polling via registerClient.
   */
  private startBackgroundPolling(): void {
    // Delay start to let nodes connect first
    setTimeout(() => {
      this.backgroundInterval = setInterval(() => {
        const connectedNodes = this.registry.getConnectedNodeIds();
        for (const nodeId of connectedNodes) {
          // Skip nodes that already have active client polling (5s)
          if (this.pollIntervals.has(nodeId)) continue;
          this.pollOnce(nodeId);
        }
      }, this.BACKGROUND_POLL_INTERVAL);
      logger.info('Background monitoring started for all connected nodes');
    }, 5000);
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

  private async pollOnce(nodeId: string): Promise<void> {
    try {
      const node = this.registry.getNode(nodeId);
      if (!node) return;

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
        // Traffic stats: nginx nodes only
        if (node.type === 'nginx') {
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
        }
        const traffic = node.type === 'nginx' ? (node.lastTrafficStats ?? null) : null;
        this.pushSnapshot(nodeId, health, stats, traffic);
      }
    } catch (err) {
      logger.debug('Polling error', { nodeId, error: (err as Error).message });
    }
  }

  private startPolling(nodeId: string): void {
    if (this.pollIntervals.has(nodeId)) return;
    logger.debug('Starting 5s polling for node', { nodeId });

    this.pollOnce(nodeId);
    this.pollIntervals.set(nodeId, setInterval(() => this.pollOnce(nodeId), 5000));
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
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
    }
    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
  }
}
