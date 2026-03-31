import { OpenAPIHono } from '@hono/zod-openapi';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('MonitoringRoutes');

import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { LogStreamService } from './log-stream.service.js';
import { MonitoringService } from './monitoring.service.js';
import { NginxConfigService } from './nginx-config.service.js';
import { NginxStatsService } from './nginx-stats.service.js';

export const monitoringRoutes = new OpenAPIHono<AppEnv>();

monitoringRoutes.use('*', authMiddleware);
monitoringRoutes.use('*', sessionOnly);

// Dashboard stats — aggregate counts for proxy hosts, SSL certs, PKI certs, CAs
monitoringRoutes.get('/dashboard', async (c) => {
  const monitoringService = container.resolve(MonitoringService);
  const stats = await monitoringService.getDashboardStats();
  return c.json({ data: stats });
});

// Health overview — all proxy hosts with health status, ordered by severity
monitoringRoutes.get('/health-status', async (c) => {
  const monitoringService = container.resolve(MonitoringService);
  const overview = await monitoringService.getHealthOverview();
  return c.json({ data: overview });
});

// Live log streaming via SSE for a specific proxy host
monitoringRoutes.get('/logs/:hostId/stream', async (c) => {
  const hostId = c.req.param('hostId');

  // Validate hostId is a UUID to prevent path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostId)) {
    return c.json({ code: 'INVALID_ID', message: 'Invalid host ID' }, 400);
  }

  const logStreamService = container.resolve(LogStreamService);

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, hostId }),
      event: 'connected',
    });

    const cleanup = logStreamService.createStream(
      hostId,
      (entry) => {
        stream
          .writeSSE({
            data: JSON.stringify(entry),
            event: 'log',
          })
          .catch(() => {
            // Stream likely closed, ignore write errors
          });
      },
      (error) => {
        stream
          .writeSSE({
            data: JSON.stringify({ error: error.message }),
            event: 'error',
          })
          .catch(() => {
            // Stream likely closed, ignore write errors
          });
      }
    );

    // Keep connection alive with periodic pings
    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
        // Stream likely closed, clean up will handle it
        clearInterval(keepalive);
      });
    }, 30_000);

    // Clean up on client disconnect
    stream.onAbort(() => {
      clearInterval(keepalive);
      cleanup();
    });

    // Keep the stream open — never resolves until client disconnects
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
monitoringRoutes.get('/nginx/info', requireScope('proxy:read'), async (c) => {
  const nginxStatsService = container.resolve(NginxStatsService);
  try {
    const info = await nginxStatsService.getProcessInfo();
    return c.json({ data: info });
  } catch (error) {
    return c.json({ data: null, error: (error as Error).message }, 503);
  }
});

// Live nginx stats SSE stream
monitoringRoutes.get('/nginx/stats/stream', requireScope('proxy:read'), async (c) => {
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
monitoringRoutes.get('/nginx/config', requireScope('proxy:read'), async (c) => {
  const nginxConfigService = container.resolve(NginxConfigService);
  const content = await nginxConfigService.getGlobalConfig();
  return c.json({ data: { content } });
});

// Update global nginx.conf
monitoringRoutes.put('/nginx/config', requireScope('proxy:manage'), async (c) => {
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
monitoringRoutes.post('/nginx/config/test', requireScope('proxy:manage'), async (c) => {
  const nginxConfigService = container.resolve(NginxConfigService);
  const result = await nginxConfigService.testConfig();
  return c.json({ data: result });
});
