import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import {
  daemonLogRelay,
  getDaemonLogHistory,
  logRelay,
  type RelayedDaemonLogEntry,
  type RelayedLogEntry,
} from '@/modules/monitoring/log-relay.service.js';
import type { AppEnv } from '@/types.js';
import { NodeMonitoringService } from './node-monitoring.service.js';
import { CreateNodeSchema, NodeListQuerySchema, UpdateNodeSchema } from './nodes.schemas.js';
import { NodesService } from './nodes.service.js';

export const nodesRoutes = new OpenAPIHono<AppEnv>();

nodesRoutes.use('*', authMiddleware);
nodesRoutes.use('*', sessionOnly);

// List nodes
nodesRoutes.get('/', requireScope('nodes:view'), async (c) => {
  const service = container.resolve(NodesService);
  const rawQuery = c.req.query();
  const query = NodeListQuerySchema.parse(rawQuery);
  const result = await service.list(query);
  return c.json(result);
});

// Get node detail
nodesRoutes.get('/:id', requireScope('nodes:view'), async (c) => {
  const service = container.resolve(NodesService);
  const id = c.req.param('id');
  const node = await service.get(id);
  return c.json({ data: node });
});

// Create node (generates enrollment token)
nodesRoutes.post('/', requireScope('nodes:manage'), async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateNodeSchema.parse(body);
  const result = await service.create(input, user.id);
  return c.json({ data: result }, 201);
});

// Update node (display name)
nodesRoutes.patch('/:id', requireScope('nodes:manage'), async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateNodeSchema.parse(body);
  const node = await service.update(id, input, user.id);
  return c.json({ data: node });
});

// Delete node
nodesRoutes.delete('/:id', requireScope('nodes:manage'), async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await service.remove(id, user.id);
  return c.json({ success: true });
});

// Read node's global nginx config
nodesRoutes.get('/:id/config', requireScope('proxy:read'), async (c) => {
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id');
  const result = await dispatch.readGlobalConfig(nodeId);
  if (!result.success) {
    return c.json({ code: 'DISPATCH_ERROR', message: result.error || 'Failed to read config' }, 502);
  }
  return c.json({ data: { content: result.detail } });
});

// Update node's global nginx config
nodesRoutes.put('/:id/config', requireScope('proxy:manage'), async (c) => {
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id');
  const body = await c.req.json<{ content: string }>();
  if (!body.content || typeof body.content !== 'string') {
    return c.json({ code: 'INVALID_BODY', message: 'content is required' }, 400);
  }
  if (body.content.length > 1_048_576) {
    return c.json({ data: { valid: false, error: 'Config exceeds 1MB limit' } }, 422);
  }
  const result = await dispatch.updateGlobalConfig(nodeId, body.content, '');
  if (!result.success) {
    return c.json({ data: { valid: false, error: result.error } }, 422);
  }
  return c.json({ data: { valid: true } });
});

// Test node's nginx config — local syntax check on provided content, then daemon test
nodesRoutes.post('/:id/config/test', requireScope('proxy:manage'), async (c) => {
  const { NginxSyntaxValidatorService } = await import('@/services/nginx-syntax-validator.service.js');
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id');

  // Get content from request body
  const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
  const content = body.content && typeof body.content === 'string' ? body.content : null;

  // 1. Local syntax validation via stub nginx if content provided
  if (content) {
    const syntaxValidator = new NginxSyntaxValidatorService();
    if (await syntaxValidator.isAvailable()) {
      const syntaxResult = await syntaxValidator.validateFull(content);
      if (!syntaxResult.valid) {
        return c.json({ data: { valid: false, error: syntaxResult.errors.join('\n') } });
      }
    }
  }

  // 2. Remote test via daemon (tests the deployed config)
  const result = await dispatch.testConfig(nodeId);
  return c.json({ data: { valid: result.success, error: result.error || undefined } });
});

// Node monitoring SSE stream — real-time health + stats at 5s intervals
nodesRoutes.get('/:id/monitoring/stream', requireScope('nodes:view'), async (c) => {
  const nodeId = c.req.param('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    return c.json({ code: 'INVALID_ID', message: 'Invalid node ID' }, 400);
  }

  const monitoringService = container.resolve(NodeMonitoringService);

  return streamSSE(c, async (stream) => {
    monitoringService.registerClient(nodeId);

    const history = monitoringService.getHistory(nodeId);
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, nodeId, history }),
      event: 'connected',
    });
    await stream.sleep(0);

    let _running = true;

    const onSnapshot = (data: { nodeId: string; snapshot: any }) => {
      if (data.nodeId === nodeId) {
        stream.writeSSE({ data: JSON.stringify(data.snapshot), event: 'snapshot' }).catch(() => {});
      }
    };
    monitoringService.on('snapshot', onSnapshot);

    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => clearInterval(keepalive));
    }, 30_000);

    stream.onAbort(() => {
      _running = false;
      clearInterval(keepalive);
      monitoringService.off('snapshot', onSnapshot);
      monitoringService.unregisterClient(nodeId);
    });

    await new Promise(() => {});
  });
});

// Daemon logs SSE stream for a specific node
// Query params: ?level=info,warn,error  &search=keyword
nodesRoutes.get('/:id/logs', requireScope('nodes:view'), async (c) => {
  const nodeId = c.req.param('id');
  const levelFilter =
    c.req
      .query('level')
      ?.split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const searchFilter = c.req.query('search')?.toLowerCase() ?? '';

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    return c.json({ code: 'INVALID_ID', message: 'Invalid node ID' }, 400);
  }

  const matchesFilter = (entry: RelayedDaemonLogEntry): boolean => {
    if (levelFilter.length > 0 && !levelFilter.includes((entry.level || '').toLowerCase())) return false;
    if (
      searchFilter &&
      !entry.message?.toLowerCase().includes(searchFilter) &&
      !entry.component?.toLowerCase().includes(searchFilter)
    )
      return false;
    return true;
  };

  return streamSSE(c, async (stream) => {
    // Send buffered history (filtered)
    const history = getDaemonLogHistory(nodeId).filter(matchesFilter).slice(-300);
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, nodeId, historyCount: history.length }),
      event: 'connected',
    });
    for (const entry of history) {
      await stream.writeSSE({ data: JSON.stringify(entry), event: 'log' });
    }
    await stream.sleep(0);

    const onLog = (entry: RelayedDaemonLogEntry) => {
      if (entry.nodeId === nodeId && matchesFilter(entry)) {
        stream.writeSSE({ data: JSON.stringify(entry), event: 'log' }).catch(() => {});
      }
    };
    daemonLogRelay.on('log', onLog);

    const keepalive = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => clearInterval(keepalive));
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(keepalive);
      daemonLogRelay.off('log', onLog);
    });

    await new Promise(() => {});
  });
});

// Nginx access logs SSE stream for all hosts on a node
// Query params: ?search=keyword&status=2xx,4xx,5xx
nodesRoutes.get('/:id/nginx-logs', requireScope('nodes:view'), async (c) => {
  const nodeId = c.req.param('id');
  const searchFilter = c.req.query('search')?.toLowerCase() ?? '';
  const statusFilter =
    c.req
      .query('status')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    return c.json({ code: 'INVALID_ID', message: 'Invalid node ID' }, 400);
  }

  // Get all host IDs assigned to this node
  const { eq } = await import('drizzle-orm');
  const { proxyHosts } = await import('@/db/schema/index.js');
  const { TOKENS } = await import('@/container.js');
  const db = container.resolve(TOKENS.DrizzleClient) as any;
  const hosts = await db.select({ id: proxyHosts.id }).from(proxyHosts).where(eq(proxyHosts.nodeId, nodeId));
  const hostIds = new Set(hosts.map((h: any) => h.id));

  const matchesFilter = (entry: RelayedLogEntry): boolean => {
    if (!hostIds.has(entry.hostId)) return false;
    if (
      searchFilter &&
      !entry.path?.toLowerCase().includes(searchFilter) &&
      !entry.remoteAddr?.includes(searchFilter) &&
      !entry.raw?.toLowerCase().includes(searchFilter)
    )
      return false;
    if (statusFilter.length > 0) {
      const code = entry.status;
      const isError = entry.logType === 'error';
      const matches = statusFilter.some((f) => {
        if (f === 'error') return isError;
        if (isError) return false;
        if (f === '2xx') return code >= 200 && code < 300;
        if (f === '3xx') return code >= 300 && code < 400;
        if (f === '4xx') return code >= 400 && code < 500;
        if (f === '5xx') return code >= 500;
        return false;
      });
      if (!matches) return false;
    }
    return true;
  };

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, nodeId, hostCount: hostIds.size }),
      event: 'connected',
    });

    const onLog = (entry: RelayedLogEntry) => {
      if (matchesFilter(entry)) {
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
