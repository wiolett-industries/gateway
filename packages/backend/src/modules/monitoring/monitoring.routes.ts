import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import { MonitoringService } from './monitoring.service.js';
import { LogStreamService } from './log-stream.service.js';
import type { AppEnv } from '@/types.js';

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
        stream.writeSSE({
          data: JSON.stringify(entry),
          event: 'log',
        }).catch(() => {
          // Stream likely closed, ignore write errors
        });
      },
      (error) => {
        stream.writeSSE({
          data: JSON.stringify({ error: error.message }),
          event: 'error',
        }).catch(() => {
          // Stream likely closed, ignore write errors
        });
      },
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
