import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { NotificationEvaluatorService } from '@/modules/notifications/notification-evaluator.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';

const logger = createChildLogger('HealthCheckJob');

const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const MAX_HISTORY_AGE_MS = 90 * 24 * 3600 * 1000; // 90 days
const SLOW_BASELINE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours of history for baseline avg

type HealthStatus = 'online' | 'offline' | 'degraded' | 'unknown';

interface HealthEntry {
  ts: string;
  status: string;
  responseMs?: number;
  slow?: boolean;
}

export class HealthCheckJob {
  private eventBus?: EventBusService;
  private evaluator?: NotificationEvaluatorService;

  constructor(private readonly db: DrizzleClient) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  setEvaluator(evaluator: NotificationEvaluatorService) {
    this.evaluator = evaluator;
  }

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
        const { status: checkStatus, responseMs } = await this.checkHost(host);

        const now = Date.now();
        const cutoff = new Date(now - MAX_HISTORY_AGE_MS).toISOString();
        const history: HealthEntry[] = ((host.healthHistory as HealthEntry[]) ?? []).filter((h) => h.ts > cutoff);

        // Compute slow flag: compare response time against baseline average
        let slow = false;
        if (checkStatus === 'online' && responseMs != null) {
          const threshold = host.healthCheckSlowThreshold ?? 3;
          if (threshold > 0) {
            const baselineCutoff = now - SLOW_BASELINE_WINDOW_MS;
            const baselineTimes = history
              .filter(
                (h) => h.status === 'online' && h.responseMs != null && new Date(h.ts).getTime() >= baselineCutoff
              )
              .map((h) => h.responseMs!);
            if (baselineTimes.length >= 5) {
              // need enough samples for a meaningful baseline
              const avgMs = baselineTimes.reduce((a, b) => a + b, 0) / baselineTimes.length;
              slow = responseMs >= avgMs * threshold;
            }
          }
        }

        // Push new entry
        const entry: HealthEntry = { ts: new Date(now).toISOString(), status: checkStatus };
        if (responseMs != null) entry.responseMs = responseMs;
        if (slow) entry.slow = true;
        history.push(entry);

        // Derive the stored healthStatus field from the check
        const newStatus: HealthStatus = checkStatus === 'online' ? (slow ? 'degraded' : 'online') : 'offline';

        // Write to DB
        await this.db
          .update(proxyHosts)
          .set({
            healthStatus: newStatus,
            lastHealthCheckAt: new Date(),
            healthHistory: history,
          })
          .where(eq(proxyHosts.id, host.id));

        await this.evaluator?.observeStatefulEvent(
          'proxy',
          newStatus === 'online' ? 'health.online' : newStatus === 'offline' ? 'health.offline' : 'health.degraded',
          {
            type: 'proxy',
            id: host.id,
            name: host.domainNames?.[0] ?? host.id,
          },
          { health_status: newStatus }
        );

        // Log status transitions and publish event
        if (previousStatus !== newStatus) {
          logger.info(`Health status changed for ${host.domainNames?.join(', ') || host.id}`, {
            hostId: host.id,
            previousStatus,
            newStatus,
            forwardHost: host.forwardHost,
          });
          const healthAction =
            newStatus === 'online' ? 'health.online' : newStatus === 'offline' ? 'health.offline' : 'health.degraded';
          this.eventBus?.publish('proxy.host.changed', {
            id: host.id,
            action: healthAction,
            domain: host.domainNames?.[0],
            health_status: newStatus,
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

  private async checkHost(
    host: typeof proxyHosts.$inferSelect
  ): Promise<{ status: 'online' | 'offline'; responseMs?: number }> {
    if (!host.forwardHost || !host.forwardPort) {
      return { status: 'offline' };
    }

    const scheme = host.forwardScheme || 'http';
    const path = host.healthCheckUrl || '/';
    const url = `${scheme}://${host.forwardHost}:${host.forwardPort}${path}`;

    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });

        const responseMs = Math.round(performance.now() - start);

        let passed = true;

        if (host.healthCheckExpectedStatus) {
          // Custom expected status code
          if (response.status !== host.healthCheckExpectedStatus) passed = false;
        } else {
          // Default: 2xx = pass
          if (response.status < 200 || response.status >= 300) passed = false;
        }

        // Body content matching
        if (passed && host.healthCheckExpectedBody) {
          try {
            const body = await response.text();
            if (!body.includes(host.healthCheckExpectedBody)) passed = false;
          } catch {
            passed = false;
          }
        }

        return { status: passed ? 'online' : 'offline', responseMs };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.debug(`Health check timed out for ${host.forwardHost}:${host.forwardPort}`);
      } else {
        logger.debug(`Health check failed for ${host.forwardHost}:${host.forwardPort}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return { status: 'offline' };
    }
  }
}
