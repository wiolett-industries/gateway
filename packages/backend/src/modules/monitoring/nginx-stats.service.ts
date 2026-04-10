import { createChildLogger } from '@/lib/logger.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';

const logger = createChildLogger('NginxStatsService');

export interface NginxStubStatus {
  activeConnections: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
}

export interface NginxSystemStats {
  cpuUsagePercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryUsagePercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
}

export interface NginxProcessInfo {
  version: string;
  workerCount: number;
  uptime: string;
  uptimeSeconds: number;
  containerStatus: string;
  configValid: boolean;
}

export interface NginxTrafficStats {
  statusCodes: { s2xx: number; s3xx: number; s4xx: number; s5xx: number };
  avgResponseTime: number;
  p95ResponseTime: number;
  totalRequests: number;
}

export interface NginxStatsSnapshot {
  timestamp: string;
  stubStatus: NginxStubStatus | null;
  systemStats: NginxSystemStats | null;
  trafficStats: NginxTrafficStats | null;
  derived: {
    requestsPerSec: number;
    connectionsPerSec: number;
  };
}

const BACKGROUND_INTERVAL_MS = 4000;
const MAX_HISTORY = 60;

export class NginxStatsService {
  private previousStubStatus: NginxStubStatus | null = null;
  private previousTimestamp = 0;
  private history: NginxStatsSnapshot[] = [];
  private cachedProcessInfo: NginxProcessInfo | null = null;
  private sseClientCount = 0;
  private backgroundInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly nodeRegistry: NodeRegistryService,
    private readonly nodeDispatch?: NodeDispatchService
  ) {
    this.startBackgroundPolling();
  }

  /** Start background polling at 4s when no SSE clients are connected. */
  private startBackgroundPolling(): void {
    // Initial fetch of process info + first snapshot so history is never empty on connect
    this.refreshProcessInfo();
    this.isAvailable()
      .then(async (available) => {
        if (available) {
          try {
            const snapshot = await this.getSnapshot();
            this.pushHistory(snapshot);
          } catch {
            /* container may be starting */
          }
        }
      })
      .catch(() => {});

    this.backgroundInterval = setInterval(async () => {
      // Skip stats if SSE clients are already driving snapshots at 2s
      if (this.sseClientCount === 0) {
        try {
          const available = await this.isAvailable();
          if (!available) {
            this.cachedProcessInfo = null;
            return;
          }
          const snapshot = await this.getSnapshot();
          this.pushHistory(snapshot);
        } catch {
          // ignore — container may be down
        }
      }
      // Refresh process info periodically (every ~30 polls = ~2 min)
      if (this.history.length > 0 && this.history.length % 30 === 0) {
        this.refreshProcessInfo();
      }
    }, BACKGROUND_INTERVAL_MS);
  }

  private async refreshProcessInfo(): Promise<void> {
    try {
      this.cachedProcessInfo = await this.getProcessInfo();
    } catch {
      this.cachedProcessInfo = null;
    }
  }

  getCachedProcessInfo(): NginxProcessInfo | null {
    return this.cachedProcessInfo;
  }

  destroy(): void {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
    }
  }

  /** Track SSE client connections so background polling can pause. */
  registerSSEClient(): void {
    this.sseClientCount++;
  }

  unregisterSSEClient(): void {
    this.sseClientCount = Math.max(0, this.sseClientCount - 1);
  }

  /** Push a snapshot to the ring buffer. Called by both background poll and SSE. */
  pushHistory(snapshot: NginxStatsSnapshot): void {
    this.history.push(snapshot);
    while (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
  }

  /** Get buffered history for instant display on connect. */
  getHistory(): NginxStatsSnapshot[] {
    return [...this.history];
  }

  async getStubStatus(): Promise<NginxStubStatus> {
    const node = this.nodeRegistry.getNodesByType('nginx')[0];
    const stats = node?.lastStatsReport;
    return {
      activeConnections: stats?.activeConnections ?? 0,
      accepts: stats?.accepts ?? 0,
      handled: stats?.handled ?? 0,
      requests: stats?.requests ?? 0,
      reading: stats?.reading ?? 0,
      writing: stats?.writing ?? 0,
      waiting: stats?.waiting ?? 0,
    };
  }

  async getContainerStats(): Promise<NginxSystemStats> {
    const node = this.nodeRegistry.getNodesByType('nginx')[0];
    const health = node?.lastHealthReport;
    return {
      cpuUsagePercent: health?.cpuPercent ?? 0,
      memoryUsageBytes: health?.memoryBytes ?? 0,
      memoryLimitBytes: 0,
      memoryUsagePercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
    };
  }

  async getProcessInfo(): Promise<NginxProcessInfo> {
    const node = this.nodeRegistry.getNodesByType('nginx')[0];
    const health = node?.lastHealthReport;
    return {
      version: health?.nginxVersion ?? 'unknown',
      workerCount: health?.workerCount ?? 0,
      uptime: health ? new Date(Date.now() - health.nginxUptimeSeconds * 1000).toISOString() : '',
      uptimeSeconds: health?.nginxUptimeSeconds ?? 0,
      containerStatus: node ? 'running' : 'stopped',
      configValid: health?.configValid ?? false,
    };
  }

  async getTrafficStats(): Promise<NginxTrafficStats> {
    if (!this.nodeDispatch) {
      return {
        statusCodes: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
        avgResponseTime: 0,
        p95ResponseTime: 0,
        totalRequests: 0,
      };
    }
    try {
      const node = this.nodeRegistry.getNodesByType('nginx')[0];
      if (!node) {
        return {
          statusCodes: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
          avgResponseTime: 0,
          p95ResponseTime: 0,
          totalRequests: 0,
        };
      }
      const nodeId = node.nodeId;
      const result = await this.nodeDispatch.requestTrafficStats(nodeId, 200);
      if (result.success && result.detail) {
        return JSON.parse(result.detail);
      }
    } catch (err) {
      logger.debug('Failed to fetch traffic stats from daemon', { error: (err as Error).message });
    }
    return {
      statusCodes: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
      avgResponseTime: 0,
      p95ResponseTime: 0,
      totalRequests: 0,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.nodeRegistry.getNodesByType('nginx').length > 0;
  }

  async getSnapshot(): Promise<NginxStatsSnapshot> {
    const now = Date.now();
    let stubStatus: NginxStubStatus | null = null;
    let systemStats: NginxSystemStats | null = null;

    let trafficStats: NginxTrafficStats | null = null;

    const withTimeout = <T>(p: Promise<T>, ms = 5000): Promise<T> =>
      Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

    const [stubResult, sysResult, trafficResult] = await Promise.allSettled([
      withTimeout(this.getStubStatus()),
      withTimeout(this.getContainerStats()),
      withTimeout(this.getTrafficStats()),
    ]);

    if (stubResult.status === 'fulfilled') {
      stubStatus = stubResult.value;
    } else {
      logger.warn('Failed to get stub_status', { error: stubResult.reason?.message });
    }

    if (sysResult.status === 'fulfilled') {
      systemStats = sysResult.value;
    } else {
      logger.warn('Failed to get container stats', { error: sysResult.reason?.message });
    }

    if (trafficResult.status === 'fulfilled') {
      trafficStats = trafficResult.value;
    } else {
      trafficStats = {
        statusCodes: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
        avgResponseTime: 0,
        p95ResponseTime: 0,
        totalRequests: 0,
      };
    }

    let requestsPerSec = 0;
    let connectionsPerSec = 0;

    if (stubStatus && this.previousStubStatus && this.previousTimestamp > 0) {
      const elapsedSec = (now - this.previousTimestamp) / 1000;
      if (elapsedSec > 0) {
        requestsPerSec = Math.max(0, (stubStatus.requests - this.previousStubStatus.requests) / elapsedSec);
        connectionsPerSec = Math.max(0, (stubStatus.accepts - this.previousStubStatus.accepts) / elapsedSec);
      }
    }

    this.previousStubStatus = stubStatus;
    this.previousTimestamp = now;

    return {
      timestamp: new Date(now).toISOString(),
      stubStatus,
      systemStats,
      trafficStats,
      derived: {
        requestsPerSec: Math.round(requestsPerSec * 100) / 100,
        connectionsPerSec: Math.round(connectionsPerSec * 100) / 100,
      },
    };
  }
}
