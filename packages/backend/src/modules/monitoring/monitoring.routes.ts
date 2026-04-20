import { OpenAPIHono } from '@hono/zod-openapi';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope } from '@/lib/permissions.js';

const logger = createChildLogger('MonitoringRoutes');

import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware, requireScope, requireScopeForResource, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { logRelay, type RelayedLogEntry } from './log-relay.service.js';
import { MonitoringService } from './monitoring.service.js';
import { NginxConfigService } from './nginx-config.service.js';
import { NginxStatsService } from './nginx-stats.service.js';

export const monitoringRoutes = new OpenAPIHono<AppEnv>();

monitoringRoutes.use('*', authMiddleware);
monitoringRoutes.use('*', sessionOnly);

// Dashboard stats — aggregate counts for proxy hosts, SSL certs, PKI certs, CAs
monitoringRoutes.get('/dashboard', async (c) => {
  const monitoringService = container.resolve(MonitoringService);
  const showSystem = c.req.query('showSystem') === 'true';
  const scopes = c.get('effectiveScopes') || [];
  const canViewProxyStats = hasScope(scopes, 'proxy:list');
  const canViewSslStats = hasScope(scopes, 'ssl:cert:list');
  const canViewPkiCertStats = hasScope(scopes, 'pki:cert:list');
  const canViewCaStats = hasScope(scopes, 'pki:ca:list:root');
  const canViewNodeStats = hasScope(scopes, 'nodes:list');
  const canViewSystemStats = showSystem && hasScope(scopes, 'admin:details:certificates');

  const stats = await monitoringService.getDashboardStats(canViewSystemStats);
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
monitoringRoutes.get('/health-status', async (c) => {
  const scopes = c.get('effectiveScopes') || [];
  if (!hasScope(scopes, 'proxy:list')) {
    return c.json({ data: [] });
  }
  const monitoringService = container.resolve(MonitoringService);
  const overview = await monitoringService.getHealthOverview();
  return c.json({ data: overview });
});

// Live log streaming via SSE for a specific proxy host
// Logs are relayed from daemon nodes via gRPC LogStream → logRelay EventEmitter → SSE
monitoringRoutes.get('/logs/:hostId/stream', requireScopeForResource('proxy:view', 'hostId'), async (c) => {
  const hostId = c.req.param('hostId');

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostId)) {
    return c.json({ code: 'INVALID_ID', message: 'Invalid host ID' }, 400);
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, hostId }),
      event: 'connected',
    });

    // Subscribe to log entries for this host
    const onLog = (entry: RelayedLogEntry) => {
      if (entry.hostId === hostId) {
        stream.writeSSE({ data: JSON.stringify(entry), event: 'log' }).catch(() => {});
      }
    };
    logRelay.on('log', onLog);

    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => clearInterval(keepalive));
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(keepalive);
      logRelay.off('log', onLog);
    });

    await new Promise(() => {});
  });
});

// ── Nginx Management ────────────────────────────────────────────────

// Check if nginx container is reachable (any authenticated user)
monitoringRoutes.get('/nginx/available', async (c) => {
  const nginxStatsService = container.resolve(NginxStatsService);
  const available = await nginxStatsService.isAvailable();
  return c.json({ data: { available } });
});

// Nginx process info
monitoringRoutes.get('/nginx/info', requireScope('proxy:list'), async (c) => {
  const nginxStatsService = container.resolve(NginxStatsService);
  try {
    const info = await nginxStatsService.getProcessInfo();
    return c.json({ data: info });
  } catch (error) {
    return c.json({ data: null, error: (error as Error).message }, 503);
  }
});

// Live nginx stats SSE stream
monitoringRoutes.get('/nginx/stats/stream', requireScope('proxy:list'), async (c) => {
  const nginxStatsService = container.resolve(NginxStatsService);

  return streamSSE(c, async (stream) => {
    nginxStatsService.registerSSEClient();

    const history = nginxStatsService.getHistory();

    // Send connected event immediately — sleep(0) forces flush
    await stream.writeSSE({
      data: JSON.stringify({
        connected: true,
        info: nginxStatsService.getCachedProcessInfo(),
        history,
        snapshot: history.length > 0 ? history[history.length - 1] : null,
      }),
      event: 'connected',
    });
    await stream.sleep(0);

    // Send first fresh snapshot immediately without waiting for poll interval
    try {
      const snapshot = await nginxStatsService.getSnapshot();
      nginxStatsService.pushHistory(snapshot);
      await stream.writeSSE({
        data: JSON.stringify(snapshot),
        event: 'stats',
      });
    } catch {
      // Container may not be available yet — will retry in poll loop
    }

    let running = true;

    stream.onAbort(() => {
      running = false;
      nginxStatsService.unregisterSSEClient();
    });

    // Poll loop — uses stream.sleep to keep Hono stream alive
    while (running) {
      await stream.sleep(2000);
      if (!running) break;
      try {
        const snapshot = await nginxStatsService.getSnapshot();
        nginxStatsService.pushHistory(snapshot);
        await stream.writeSSE({
          data: JSON.stringify(snapshot),
          event: 'stats',
        });
      } catch (err) {
        logger.warn('SSE snapshot error', { error: (err as Error).message });
        await stream
          .writeSSE({
            data: JSON.stringify({ error: (err as Error).message }),
            event: 'error',
          })
          .catch(() => {});
      }
    }
  });
});

// Read global nginx.conf
monitoringRoutes.get('/nginx/config', requireScope('proxy:list'), async (c) => {
  const nginxConfigService = container.resolve(NginxConfigService);
  const content = await nginxConfigService.getGlobalConfig();
  return c.json({ data: { content } });
});

// Update global nginx.conf
monitoringRoutes.put('/nginx/config', requireScope('proxy:edit'), async (c) => {
  const body = await c.req.json<{ content: string }>();
  if (!body.content || typeof body.content !== 'string') {
    return c.json({ code: 'INVALID_BODY', message: 'content is required' }, 400);
  }
  const nginxConfigService = container.resolve(NginxConfigService);
  const result = await nginxConfigService.updateGlobalConfig(body.content);
  if (!result.valid) {
    return c.json({ data: result }, 422);
  }
  return c.json({ data: result });
});

// Test current nginx config
monitoringRoutes.post('/nginx/config/test', requireScope('proxy:edit'), async (c) => {
  const nginxConfigService = container.resolve(NginxConfigService);
  const result = await nginxConfigService.testConfig();
  return c.json({ data: result });
});
