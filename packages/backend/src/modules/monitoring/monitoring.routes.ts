import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { streamSSE } from 'hono/streaming';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { getResourceScopedIds, hasScope, hasScopeBase } from '@/lib/permissions.js';
import { authMiddleware, requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import type { AppEnv } from '@/types.js';
import { getNginxLogHistory, logRelay, type RelayedLogEntry } from './log-relay.service.js';
import { dashboardStatsRoute, healthStatusRoute, proxyLogStreamRoute } from './monitoring.docs.js';
import { MonitoringService } from './monitoring.service.js';
import { subscribeNginxHostLogs } from './nginx-log-subscriptions.js';

export const monitoringRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

monitoringRoutes.use('*', authMiddleware);

// Dashboard stats — aggregate counts for proxy hosts, SSL certs, PKI certs, CAs
monitoringRoutes.openapi(dashboardStatsRoute, async (c) => {
  const monitoringService = container.resolve(MonitoringService);
  const showSystem = c.req.query('showSystem') === 'true';
  const scopes = c.get('effectiveScopes') || [];
  const canViewProxyStats = hasScopeBase(scopes, 'proxy:view');
  const canViewSslStats = hasScopeBase(scopes, 'ssl:cert:view');
  const canViewPkiCertStats = hasScopeBase(scopes, 'pki:cert:view');
  const canViewCaStats = hasScope(scopes, 'pki:ca:view:root') || hasScope(scopes, 'pki:ca:view:intermediate');
  const canViewNodeStats = hasScopeBase(scopes, 'nodes:details');
  const canViewSystemStats = showSystem && hasScope(scopes, 'admin:details:certificates');

  const stats = await monitoringService.getDashboardStats({
    showSystem: canViewSystemStats,
    allowedCaTypes: [
      hasScope(scopes, 'pki:ca:view:root') ? 'root' : null,
      hasScope(scopes, 'pki:ca:view:intermediate') ? 'intermediate' : null,
    ].filter((type): type is 'root' | 'intermediate' => !!type),
    allowedProxyHostIds: hasScope(scopes, 'proxy:view') ? undefined : getResourceScopedIds(scopes, 'proxy:view'),
    allowedSslCertificateIds: hasScope(scopes, 'ssl:cert:view')
      ? undefined
      : getResourceScopedIds(scopes, 'ssl:cert:view'),
    allowedPkiCertificateIds: hasScope(scopes, 'pki:cert:view')
      ? undefined
      : getResourceScopedIds(scopes, 'pki:cert:view'),
    allowedNodeIds: hasScope(scopes, 'nodes:details') ? undefined : getResourceScopedIds(scopes, 'nodes:details'),
  });
  return c.json({
    data: {
      proxyHosts: canViewProxyStats ? stats.proxyHosts : { total: 0, enabled: 0, online: 0, offline: 0, degraded: 0 },
      sslCertificates: canViewSslStats ? stats.sslCertificates : { total: 0, active: 0, expiringSoon: 0, expired: 0 },
      pkiCertificates: canViewPkiCertStats ? stats.pkiCertificates : { total: 0, active: 0, revoked: 0, expired: 0 },
      cas: canViewCaStats ? stats.cas : { total: 0, active: 0 },
      nodes: canViewNodeStats ? stats.nodes : { total: 0, online: 0, offline: 0, pending: 0 },
    },
  });
});

// Health overview — all proxy hosts with health status, ordered by severity
monitoringRoutes.openapi(healthStatusRoute, async (c) => {
  const scopes = c.get('effectiveScopes') || [];
  if (!hasScopeBase(scopes, 'proxy:view')) {
    return c.json({ data: [] });
  }
  const monitoringService = container.resolve(MonitoringService);
  const overview = await monitoringService.getHealthOverview(
    hasScope(scopes, 'proxy:view') ? undefined : { allowedHostIds: getResourceScopedIds(scopes, 'proxy:view') }
  );
  return c.json({ data: overview });
});

monitoringRoutes.openapi(
  { ...proxyLogStreamRoute, middleware: requireScopeForResource('proxy:view', 'hostId') },
  async (c) => {
    const hostId = c.req.param('hostId')!;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostId)) {
      return c.json({ code: 'INVALID_ID', message: 'Invalid host ID' }, 400);
    }

    const db = container.resolve(TOKENS.DrizzleClient) as DrizzleClient;
    const [host] = await db
      .select({ nodeId: proxyHosts.nodeId })
      .from(proxyHosts)
      .where(eq(proxyHosts.id, hostId))
      .limit(1);

    if (!host) return c.json({ code: 'NOT_FOUND', message: 'Proxy host not found' }, 404);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: JSON.stringify({ connected: true, hostId }),
        event: 'connected',
      });

      if (!host.nodeId) {
        await stream.writeSSE({
          data: JSON.stringify({ message: 'Proxy host has no nginx node assigned' }),
          event: 'log-error',
        });
        return;
      }

      const nodeRegistry = container.resolve(NodeRegistryService);
      const subscription = subscribeNginxHostLogs(nodeRegistry, host.nodeId, hostId, 0);
      if (!subscription.ok) {
        await stream.writeSSE({
          data: JSON.stringify({ message: subscription.message }),
          event: 'log-error',
        });
        return;
      }

      // Subscribe to log entries for this host
      const onLog = (entry: RelayedLogEntry) => {
        if (entry.hostId === hostId) {
          stream.writeSSE({ data: JSON.stringify(entry), event: 'log' }).catch(() => {});
        }
      };
      logRelay.on('log', onLog);

      for (const entry of getNginxLogHistory(hostId)) {
        await stream.writeSSE({ data: JSON.stringify(entry), event: 'log' });
      }

      const keepalive = setInterval(() => {
        stream.writeSSE({ data: '', event: 'ping' }).catch(() => clearInterval(keepalive));
      }, 30_000);

      stream.onAbort(() => {
        clearInterval(keepalive);
        logRelay.off('log', onLog);
        subscription.cleanup();
      });

      await new Promise(() => {});
    });
  }
);
