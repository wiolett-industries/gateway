import { eq, and } from 'drizzle-orm';
import { lookup } from 'node:dns/promises';
import { proxyHosts } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';

const logger = createChildLogger('HealthCheckJob');

const HEALTH_CHECK_TIMEOUT_MS = 10_000;

type HealthStatus = 'online' | 'offline' | 'degraded' | 'unknown';

/** Check if an IP address is in a private/reserved range */
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (/^127\./.test(ip)) return true;           // loopback
  if (/^10\./.test(ip)) return true;            // RFC 1918
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true; // RFC 1918
  if (/^192\.168\./.test(ip)) return true;      // RFC 1918
  if (/^169\.254\./.test(ip)) return true;      // link-local
  if (/^0\./.test(ip)) return true;             // current network
  if (ip === '::1' || ip === '::') return true; // IPv6 loopback
  if (/^f[cd]/i.test(ip)) return true;          // IPv6 ULA
  if (/^fe80:/i.test(ip)) return true;          // IPv6 link-local
  return false;
}

export class HealthCheckJob {
  constructor(private readonly db: DrizzleClient) {}

  async run(): Promise<void> {
    // Query proxy hosts with health checks enabled
    const hosts = await this.db.query.proxyHosts.findMany({
      where: and(
        eq(proxyHosts.healthCheckEnabled, true),
        eq(proxyHosts.enabled, true),
      ),
    });

    if (hosts.length === 0) {
      return;
    }

    logger.debug(`Running health checks for ${hosts.length} host(s)`);

    // Run all health checks in parallel
    const results = await Promise.allSettled(
      hosts.map(async (host) => {
        const previousStatus = host.healthStatus as HealthStatus;
        const newStatus = await this.checkHost(host);

        // Update status in DB
        await this.db
          .update(proxyHosts)
          .set({
            healthStatus: newStatus,
            lastHealthCheckAt: new Date(),
          })
          .where(eq(proxyHosts.id, host.id));

        // Log status transitions
        if (previousStatus !== newStatus) {
          logger.info(`Health status changed for ${host.domainNames?.join(', ') || host.id}`, {
            hostId: host.id,
            previousStatus,
            newStatus,
            forwardHost: host.forwardHost,
          });
        }

        return { hostId: host.id, status: newStatus };
      }),
    );

    // Summarize results
    let online = 0;
    let offline = 0;
    let degraded = 0;
    let errors = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        switch (result.value.status) {
          case 'online': online++; break;
          case 'offline': offline++; break;
          case 'degraded': degraded++; break;
        }
      } else {
        errors++;
        logger.error('Health check execution failed', { error: result.reason });
      }
    }

    if (offline > 0 || degraded > 0 || errors > 0) {
      logger.info('Health check summary', { online, offline, degraded, errors, total: hosts.length });
    }
  }

  private async checkHost(host: typeof proxyHosts.$inferSelect): Promise<HealthStatus> {
    if (!host.forwardHost || !host.forwardPort) {
      return 'unknown';
    }

    const scheme = host.forwardScheme || 'http';
    const path = host.healthCheckUrl || '/';
    const url = `${scheme}://${host.forwardHost}:${host.forwardPort}${path}`;

    // SSRF protection: resolve hostname and block private/internal IPs
    try {
      const resolved = await lookup(host.forwardHost);
      if (isPrivateIP(resolved.address)) {
        logger.debug(`Skipping health check for ${host.forwardHost}: resolves to private IP ${resolved.address}`);
        return 'unknown';
      }
    } catch {
      // DNS resolution failed — host unreachable
      return 'offline';
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);

        if (response.status >= 200 && response.status < 300) {
          return 'online';
        }
        if (response.status >= 500) {
          return 'offline';
        }
        // 3xx (after redirect), 4xx, or other non-2xx/non-5xx
        return 'degraded';
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      // Timeout (AbortError) or network error
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.debug(`Health check timed out for ${host.forwardHost}:${host.forwardPort}`);
      } else {
        logger.debug(`Health check failed for ${host.forwardHost}:${host.forwardPort}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return 'offline';
    }
  }
}
