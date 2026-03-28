import { OpenAPIHono } from '@hono/zod-openapi';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('MonitoringRoutes');
import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { LogStreamService } from './log-stream.service.js';
import { MonitoringService } from './monitoring.service.js';
import { NginxConfigService } from './nginx-config.service.js';
import { NginxStatsService } from './nginx-stats.service.js';

export const monitoringRoutes = new OpenAPIHono<AppEnv>();

monitoringRoutes.use('*', authMiddleware);

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

// Nginx process info (admin, operator)
monitoringRoutes.get('/nginx/info', async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'admin' && user.role !== 'operator') {
    return c.json({ code: 'FORBIDDEN', message: 'Admin or operator role required' }, 403);
  }
  const nginxStatsService = container.resolve(NginxStatsService);
  try {
    const info = await nginxStatsService.getProcessInfo();
    return c.json({ data: info });
  } catch (error) {
    return c.json({ data: null, error: (error as Error).message }, 503);
  }
});

// Live nginx stats SSE stream (admin, operator)
monitoringRoutes.get('/nginx/stats/stream', async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'admin' && user.role !== 'operator') {
    return c.json({ code: 'FORBIDDEN', message: 'Admin or operator role required' }, 403);
  }

  const nginxStatsService = container.resolve(NginxStatsService);

  return streamSSE(c, async (stream) => {
    nginxStatsService.registerSSEClient();

    // Send cached process info + buffered history immediately on connect (no async delay)
    await stream.writeSSE({
      data: JSON.stringify({
        connected: true,
        info: nginxStatsService.getCachedProcessInfo(),
        history: nginxStatsService.getHistory(),
      }),
      event: 'connected',
    });

    let running = true;

    stream.onAbort(() => {
      running = false;
      nginxStatsService.unregisterSSEClient();
    });

    // Keep the stream alive by polling in a loop
    while (running) {
      try {
        const snapshot = await nginxStatsService.getSnapshot();
        nginxStatsService.pushHistory(snapshot);
        await stream.writeSSE({
          data: JSON.stringify(snapshot),
          event: 'stats',
        });
      } catch {
        await stream.writeSSE({
          data: JSON.stringify({ error: 'Failed to collect stats' }),
          event: 'error',
        }).catch(() => {});
      }
      // Wait 2 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });
});

// Read global nginx.conf (admin, operator)
monitoringRoutes.get('/nginx/config', async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'admin' && user.role !== 'operator') {
    return c.json({ code: 'FORBIDDEN', message: 'Admin or operator role required' }, 403);
  }
  const nginxConfigService = container.resolve(NginxConfigService);
  const content = await nginxConfigService.getGlobalConfig();
  return c.json({ data: { content } });
});

// Update global nginx.conf (admin only)
monitoringRoutes.put('/nginx/config', async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'admin') {
    return c.json({ code: 'FORBIDDEN', message: 'Admin role required' }, 403);
  }
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

// Test current nginx config (admin, operator)
monitoringRoutes.post('/nginx/config/test', async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'admin' && user.role !== 'operator') {
    return c.json({ code: 'FORBIDDEN', message: 'Admin or operator role required' }, 403);
  }
  const nginxConfigService = container.resolve(NginxConfigService);
  const result = await nginxConfigService.testConfig();
  return c.json({ data: result });
});
