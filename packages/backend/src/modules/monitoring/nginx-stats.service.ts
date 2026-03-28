import { createChildLogger } from '@/lib/logger.js';
import type { DockerContainerStats, DockerService } from '@/services/docker.service.js';

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
    private readonly dockerService: DockerService,
    private readonly nginxContainerName: string
  ) {
    this.startBackgroundPolling();
  }

  /** Start background polling at 4s when no SSE clients are connected. */
  private startBackgroundPolling(): void {
    // Initial fetch of process info
    this.refreshProcessInfo();

    this.backgroundInterval = setInterval(async () => {
      // Skip stats if SSE clients are already driving snapshots at 2s
      if (this.sseClientCount === 0) {
        try {
          const available = await this.isAvailable();
          if (!available) { this.cachedProcessInfo = null; return; }
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

  /**
   * Parse nginx stub_status output:
   *   Active connections: 1
   *   server accepts handled requests
   *    16 16 31
   *   Reading: 0 Writing: 1 Waiting: 0
   */
  private parseStubStatus(output: string): NginxStubStatus {
    const activeMatch = output.match(/Active connections:\s*(\d+)/);
    const countersMatch = output.match(/\s+(\d+)\s+(\d+)\s+(\d+)/);
    const rwwMatch = output.match(/Reading:\s*(\d+)\s+Writing:\s*(\d+)\s+Waiting:\s*(\d+)/);

    return {
      activeConnections: activeMatch ? parseInt(activeMatch[1], 10) : 0,
      accepts: countersMatch ? parseInt(countersMatch[1], 10) : 0,
      handled: countersMatch ? parseInt(countersMatch[2], 10) : 0,
      requests: countersMatch ? parseInt(countersMatch[3], 10) : 0,
      reading: rwwMatch ? parseInt(rwwMatch[1], 10) : 0,
      writing: rwwMatch ? parseInt(rwwMatch[2], 10) : 0,
      waiting: rwwMatch ? parseInt(rwwMatch[3], 10) : 0,
    };
  }

  async getStubStatus(): Promise<NginxStubStatus> {
    const result = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['wget', '-qO-', 'http://127.0.0.1/nginx_status']
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to fetch stub_status: ${result.output}`);
    }
    return this.parseStubStatus(result.output);
  }

  async getContainerStats(): Promise<NginxSystemStats> {
    const raw = await this.dockerService.getContainerStats(this.nginxContainerName);
    return this.computeSystemStats(raw);
  }

  private computeSystemStats(raw: DockerContainerStats): NginxSystemStats {
    const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
    const systemDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
    const cpuPercent = systemDelta > 0
      ? (cpuDelta / systemDelta) * (raw.cpu_stats.online_cpus || 1) * 100
      : 0;

    const memUsage = raw.memory_stats.usage - (raw.memory_stats.stats?.cache ?? 0);
    const memLimit = raw.memory_stats.limit;
    const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

    let rxBytes = 0;
    let txBytes = 0;
    if (raw.networks) {
      for (const iface of Object.values(raw.networks)) {
        rxBytes += iface.rx_bytes;
        txBytes += iface.tx_bytes;
      }
    }

    let readBytes = 0;
    let writeBytes = 0;
    if (raw.blkio_stats.io_service_bytes_recursive) {
      for (const entry of raw.blkio_stats.io_service_bytes_recursive) {
        if (entry.op === 'read' || entry.op === 'Read') readBytes += entry.value;
        if (entry.op === 'write' || entry.op === 'Write') writeBytes += entry.value;
      }
    }

    return {
      cpuUsagePercent: Math.round(cpuPercent * 100) / 100,
      memoryUsageBytes: memUsage,
      memoryLimitBytes: memLimit,
      memoryUsagePercent: Math.round(memPercent * 100) / 100,
      networkRxBytes: rxBytes,
      networkTxBytes: txBytes,
      blockReadBytes: readBytes,
      blockWriteBytes: writeBytes,
    };
  }

  async getProcessInfo(): Promise<NginxProcessInfo> {
    const versionResult = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['nginx', '-v']
    );
    const versionMatch = versionResult.output.match(/nginx\/([\d.]+)/);

    const psResult = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['sh', '-c', 'ps aux | grep "nginx: worker" | grep -v grep | wc -l']
    );

    const inspect = await this.dockerService.inspectContainer(this.nginxContainerName);
    const startedAt = new Date(inspect.State.StartedAt);
    const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    const configTest = await this.dockerService.testNginxConfig();

    return {
      version: versionMatch ? versionMatch[1] : 'unknown',
      workerCount: parseInt(psResult.output.trim(), 10) || 0,
      uptime: inspect.State.StartedAt,
      uptimeSeconds,
      containerStatus: inspect.State.Status,
      configValid: configTest.valid,
    };
  }

  async getTrafficStats(): Promise<NginxTrafficStats> {
    // Tail last 200 lines from all access logs
    const result = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['sh', '-c', 'find /var/log/nginx -name "*.access.log" -o -name "access.log" 2>/dev/null | xargs tail -n 200 2>/dev/null || true']
    );

    const statusCodes = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
    const responseTimes: number[] = [];
    let totalRequests = 0;

    // Parse each line — match status code and optional upstream_response_time
    const statusRegex = /"\s+(\d{3})\s+/;
    const rtRegex = /"([\d.]+)"?\s*$/;

    for (const line of result.output.split('\n')) {
      if (!line || line.startsWith('==>')) continue; // skip tail headers
      const statusMatch = line.match(statusRegex);
      if (!statusMatch) continue;

      totalRequests++;
      const status = parseInt(statusMatch[1], 10);
      if (status >= 200 && status < 300) statusCodes.s2xx++;
      else if (status >= 300 && status < 400) statusCodes.s3xx++;
      else if (status >= 400 && status < 500) statusCodes.s4xx++;
      else if (status >= 500) statusCodes.s5xx++;

      const rtMatch = line.match(rtRegex);
      if (rtMatch && rtMatch[1] !== '-') {
        const rt = parseFloat(rtMatch[1]);
        if (!isNaN(rt) && rt >= 0) responseTimes.push(rt);
      }
    }

    let avgResponseTime = 0;
    let p95ResponseTime = 0;
    if (responseTimes.length > 0) {
      avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      responseTimes.sort((a, b) => a - b);
      p95ResponseTime = responseTimes[Math.floor(responseTimes.length * 0.95)] ?? 0;
    }

    return {
      statusCodes,
      avgResponseTime: Math.round(avgResponseTime * 1000) / 1000,
      p95ResponseTime: Math.round(p95ResponseTime * 1000) / 1000,
      totalRequests,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.dockerService.inspectContainer(this.nginxContainerName);
      return true;
    } catch {
      return false;
    }
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
    }

    let requestsPerSec = 0;
    let connectionsPerSec = 0;

    if (stubStatus && this.previousStubStatus && this.previousTimestamp > 0) {
      const elapsedSec = (now - this.previousTimestamp) / 1000;
      if (elapsedSec > 0) {
        requestsPerSec = Math.max(0,
          (stubStatus.requests - this.previousStubStatus.requests) / elapsedSec
        );
        connectionsPerSec = Math.max(0,
          (stubStatus.accepts - this.previousStubStatus.accepts) / elapsedSec
        );
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
