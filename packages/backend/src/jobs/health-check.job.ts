import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('HealthCheckJob');

const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const MAX_HISTORY_AGE_MS = 90 * 24 * 3600 * 1000; // 90 days

type HealthStatus = 'online' | 'offline' | 'degraded' | 'unknown';

export class HealthCheckJob {
  constructor(private readonly db: DrizzleClient) {}

  async run(): Promise<void> {
    // Query proxy hosts with health checks enabled
    const hosts = await this.db.query.proxyHosts.findMany({
      where: and(eq(proxyHosts.healthCheckEnabled, true), eq(proxyHosts.enabled, true)),
    });

    if (hosts.length === 0) {
      logger.debug('No hosts with health checks enabled');
      return;
    }

    logger.info(`Running health checks for ${hosts.length} host(s)`);

    // Run all health checks in parallel
    const results = await Promise.allSettled(
      hosts.map(async (host) => {
        const previousStatus = host.healthStatus as HealthStatus;
        const newStatus = await this.checkHost(host);

        // Build update payload
        const updatePayload: Record<string, unknown> = {
          healthStatus: newStatus,
          lastHealthCheckAt: new Date(),
        };

        // Record every health check result, prune entries older than 90 days
        const now = Date.now();
        const cutoff = new Date(now - MAX_HISTORY_AGE_MS).toISOString();
        const history: Array<{ ts: string; status: string }> = (
          (host.healthHistory as Array<{ ts: string; status: string }>) ?? []
        ).filter((h) => h.ts > cutoff);

        history.push({ ts: new Date(now).toISOString(), status: newStatus });
        updatePayload.healthHistory = history;

        // Write to DB
        await this.db.update(proxyHosts).set(updatePayload).where(eq(proxyHosts.id, host.id));

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
      })
    );

    // Summarize results
    let online = 0;
    let offline = 0;
    let degraded = 0;
    let errors = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        switch (result.value.status) {
          case 'online':
            online++;
            break;
          case 'offline':
            offline++;
            break;
          case 'degraded':
            degraded++;
            break;
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

        let status: HealthStatus;

        if (host.healthCheckExpectedStatus) {
          // Custom expected status code check
          status = response.status === host.healthCheckExpectedStatus ? 'online' : 'offline';
        } else {
          // Default 2xx/5xx/other logic
          if (response.status >= 200 && response.status < 300) {
            status = 'online';
          } else if (response.status >= 500) {
            status = 'offline';
          } else {
            // 3xx (after redirect), 4xx, or other non-2xx/non-5xx
            status = 'degraded';
          }
        }

        // Body content matching (only if status is 'online' and expectedBody is set)
        if (status === 'online' && host.healthCheckExpectedBody) {
          try {
            const body = await response.text();
            if (!body.includes(host.healthCheckExpectedBody)) {
              status = 'degraded';
            }
          } catch {
            // Failed to read body — treat as degraded
            status = 'degraded';
          }
        }

        return status;
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
