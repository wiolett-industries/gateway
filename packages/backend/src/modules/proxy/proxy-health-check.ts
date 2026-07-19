import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { formatHostPort } from '@/lib/network-endpoint.js';
import type { HealthCheckBodyMatchMode } from './proxy.service-helpers.js';
import { matchesExpectedBody } from './proxy.service-helpers.js';

interface ProxyHealthLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
}

export function runImmediateProxyHealthCheck({
  db,
  hostId,
  logger,
}: {
  db: DrizzleClient;
  hostId: string;
  logger: ProxyHealthLogger;
}): void {
  // Run after a short delay to allow nginx reload to complete.
  setTimeout(async () => {
    try {
      const host = await db.query.proxyHosts.findFirst({
        where: eq(proxyHosts.id, hostId),
      });
      if (
        !host?.enabled ||
        !host.healthCheckEnabled ||
        host.maintenanceEnabled ||
        !host.forwardHost ||
        !host.forwardPort
      )
        return;

      const scheme = host.forwardScheme || 'http';
      const path = host.healthCheckUrl || '/';
      const url = `${scheme}://${formatHostPort(host.forwardHost, host.forwardPort)}${path}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      let status: 'online' | 'offline' | 'degraded' = 'offline';
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timeout);

        const expectedStatus = (host as any).healthCheckExpectedStatus as number | null;
        if (expectedStatus) {
          status = response.status === expectedStatus ? 'online' : 'offline';
        } else {
          if (response.status >= 200 && response.status < 300) status = 'online';
          else if (response.status >= 500) status = 'offline';
          else status = 'degraded';
        }

        const expectedBody = (host as any).healthCheckExpectedBody as string | null;
        const bodyMatchMode = ((host as any).healthCheckBodyMatchMode as HealthCheckBodyMatchMode | null) ?? 'includes';
        if (expectedBody && status === 'online') {
          const body = await response.text();
          if (!matchesExpectedBody(body, expectedBody, bodyMatchMode)) status = 'degraded';
        }
      } catch {
        clearTimeout(timeout);
        status = 'offline';
      }

      const persisted = await db
        .update(proxyHosts)
        .set({ healthStatus: status, lastHealthCheckAt: new Date() })
        .where(
          and(
            eq(proxyHosts.id, hostId),
            eq(proxyHosts.enabled, true),
            eq(proxyHosts.healthCheckEnabled, true),
            eq(proxyHosts.maintenanceEnabled, false)
          )
        )
        .returning({ id: proxyHosts.id });

      if (persisted.length === 0) return;

      logger.debug('Immediate health check complete', { hostId, status });
    } catch (err) {
      logger.debug('Immediate health check failed', { hostId, error: err });
    }
  }, 2000);
}
