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

  nginxStatsService.registerSSEClient();
  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream({
    async pull(controller) {
      if (cancelled) { controller.close(); return; }

      try {
        const snapshot = await nginxStatsService.getSnapshot();
        nginxStatsService.pushHistory(snapshot);
        controller.enqueue(encoder.encode(`event: stats\ndata: ${JSON.stringify(snapshot)}\n\n`));
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
      }

      // Wait 2s before next pull
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
    cancel() {
      cancelled = true;
      nginxStatsService.unregisterSSEClient();
    },
  });

  // Prepend connected event
  const connectedEvent = `event: connected\ndata: ${JSON.stringify({
    connected: true,
    info: nginxStatsService.getCachedProcessInfo(),
    history: nginxStatsService.getHistory(),
  })}\n\n`;

  const prependedBody = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(connectedEvent));
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      nginxStatsService.unregisterSSEClient();
    },
  });

  return new Response(prependedBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
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
