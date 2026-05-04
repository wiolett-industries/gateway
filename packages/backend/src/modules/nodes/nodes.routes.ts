import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { getResourceScopedIds, hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import { authMiddleware, requireScope, requireScopeForResource, sessionOnly } from '@/modules/auth/auth.middleware.js';
import {
  daemonLogRelay,
  getDaemonLogHistory,
  logRelay,
  type RelayedDaemonLogEntry,
  type RelayedLogEntry,
} from '@/modules/monitoring/log-relay.service.js';
import type { AppEnv } from '@/types.js';
import { NodeMonitoringService } from './node-monitoring.service.js';
import {
  createNodeRoute,
  deleteNodeRoute,
  getNodeConfigRoute,
  getNodeHealthHistoryRoute,
  getNodeRoute,
  listNodesRoute,
  nodeDaemonLogsRoute,
  nodeMonitoringStreamRoute,
  nodeNginxLogsRoute,
  testNodeConfigRoute,
  updateNodeConfigRoute,
  updateNodeRoute,
  updateNodeServiceCreationLockRoute,
} from './nodes.docs.js';
import {
  CreateNodeSchema,
  NodeListQuerySchema,
  UpdateNodeSchema,
  UpdateNodeServiceCreationLockSchema,
} from './nodes.schemas.js';
import { NodesService } from './nodes.service.js';

export const nodesRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

nodesRoutes.use('*', authMiddleware);

const BROAD_DOCKER_VIEW_SCOPES = [
  'docker:containers:view',
  'docker:images:view',
  'docker:volumes:view',
  'docker:networks:view',
] as const;

const RESOURCE_SCOPED_DOCKER_NODE_SCOPES = [
  'docker:containers:view',
  'docker:containers:create',
  'docker:containers:manage',
  'docker:containers:delete',
  'docker:containers:edit',
  'docker:containers:environment',
  'docker:containers:secrets',
  'docker:containers:files',
  'docker:containers:webhooks',
  'docker:containers:mounts',
  'docker:images:view',
  'docker:images:pull',
  'docker:images:delete',
  'docker:volumes:view',
  'docker:volumes:create',
  'docker:volumes:delete',
  'docker:networks:view',
  'docker:networks:create',
  'docker:networks:delete',
  'docker:networks:edit',
] as const;

function hasBroadDockerNodeListAccess(scopes: string[]) {
  return BROAD_DOCKER_VIEW_SCOPES.some((scope) => hasScope(scopes, scope));
}

function getDockerResourceScopedNodeIds(scopes: string[]) {
  const ids = new Set<string>();
  for (const scope of RESOURCE_SCOPED_DOCKER_NODE_SCOPES) {
    for (const id of getResourceScopedIds(scopes, scope)) ids.add(id);
  }
  return [...ids];
}

function compactDockerNodeForDockerAccess(node: Record<string, unknown>) {
  const capabilities = node.capabilities as Record<string, unknown> | null | undefined;
  const health = node.lastHealthReport as Record<string, unknown> | null | undefined;
  return {
    id: node.id,
    type: node.type,
    hostname: node.hostname,
    displayName: node.displayName,
    status: node.status,
    serviceCreationLocked: node.serviceCreationLocked,
    daemonVersion: node.daemonVersion,
    osInfo: null,
    configVersionHash: null,
    capabilities: {
      ...(capabilities?.versionMismatch ? { versionMismatch: true } : {}),
      ...(capabilities?.cpuCores !== undefined ? { cpuCores: capabilities.cpuCores } : {}),
    },
    lastSeenAt: node.lastSeenAt,
    lastHealthReport: health
      ? {
          systemMemoryTotalBytes: health.systemMemoryTotalBytes,
          swapTotalBytes: health.swapTotalBytes,
        }
      : null,
    lastStatsReport: null,
    metadata: {},
    isConnected: node.isConnected,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function compactMonitoringHistorySnapshot(snapshot: any) {
  const health = snapshot?.health ?? {};
  const stats = snapshot?.stats ?? {};
  const traffic = snapshot?.traffic ?? null;
  return {
    timestamp: snapshot?.timestamp,
    health: {
      cpuPercent: health.cpuPercent,
      systemMemoryUsedBytes: health.systemMemoryUsedBytes,
      systemMemoryTotalBytes: health.systemMemoryTotalBytes,
      swapUsedBytes: health.swapUsedBytes,
      swapTotalBytes: health.swapTotalBytes,
      diskReadBytes: health.diskReadBytes,
      diskWriteBytes: health.diskWriteBytes,
      diskMounts: Array.isArray(health.diskMounts)
        ? health.diskMounts.map((mount: any) => ({
            mountPoint: mount.mountPoint,
            filesystem: mount.filesystem,
            device: mount.device,
            totalBytes: mount.totalBytes,
            usedBytes: mount.usedBytes,
            freeBytes: mount.freeBytes,
            usagePercent: mount.usagePercent,
          }))
        : undefined,
      diskUsagePercent: health.diskUsagePercent,
      networkRxBytes: health.networkRxBytes,
      networkTxBytes: health.networkTxBytes,
      networkInterfaces: health.networkInterfaces,
    },
    stats: {
      activeConnections: stats.activeConnections,
      accepts: stats.accepts,
      handled: stats.handled,
      requests: stats.requests,
      reading: stats.reading,
      writing: stats.writing,
      waiting: stats.waiting,
    },
    traffic,
  };
}

nodesRoutes.openapi(listNodesRoute, async (c) => {
  const service = container.resolve(NodesService);
  const query = NodeListQuerySchema.parse(c.req.query());
  const scopes = c.get('effectiveScopes') || [];
  const hasNodeDetails = hasScope(scopes, 'nodes:details');
  const allowedNodeIds = getResourceScopedIds(scopes, 'nodes:details');
  const dockerScopedNodeIds = query.type === 'docker' ? getDockerResourceScopedNodeIds(scopes) : [];
  const canListAllDockerNodes = query.type === 'docker' && hasBroadDockerNodeListAccess(scopes);
  const canListDockerNodes = canListAllDockerNodes || dockerScopedNodeIds.length > 0;
  if (!hasNodeDetails && allowedNodeIds.length === 0 && !canListDockerNodes) {
    throw new AppError(403, 'FORBIDDEN', 'Missing required node access scope');
  }
  const scopedNodeIds =
    query.type === 'docker' && !canListAllDockerNodes
      ? [...new Set([...allowedNodeIds, ...dockerScopedNodeIds])]
      : allowedNodeIds;
  const result = await service.list(
    query,
    hasNodeDetails || canListAllDockerNodes ? undefined : { allowedIds: scopedNodeIds }
  );
  if (query.type === 'docker' && canListDockerNodes && !hasNodeDetails) {
    return c.json({ ...result, data: result.data.map((node) => compactDockerNodeForDockerAccess(node as any)) });
  }
  return c.json(result);
});

nodesRoutes.openapi({ ...getNodeRoute, middleware: requireScopeForResource('nodes:details', 'id') }, async (c) => {
  const service = container.resolve(NodesService);
  const id = c.req.param('id')!;
  const node = await service.get(id);
  return c.json({ data: node });
});

nodesRoutes.openapi(
  { ...getNodeHealthHistoryRoute, middleware: requireScopeForResource('nodes:details', 'id') },
  async (c) => {
    const service = container.resolve(NodesService);
    const id = c.req.param('id')!;
    const healthHistory = await service.getHealthHistory(id);
    return c.json({ data: healthHistory });
  }
);

nodesRoutes.openapi({ ...createNodeRoute, middleware: requireScope('nodes:create') }, async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const input = CreateNodeSchema.parse(await c.req.json());
  const result = await service.create(input, user.id);
  return c.json({ data: result }, 201);
});

nodesRoutes.openapi({ ...updateNodeRoute, middleware: requireScopeForResource('nodes:rename', 'id') }, async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const input = UpdateNodeSchema.parse(await c.req.json());
  const node = await service.update(id, input, user.id);
  return c.json({ data: node });
});

nodesRoutes.openapi(
  { ...updateNodeServiceCreationLockRoute, middleware: requireScopeForResource('nodes:lock', 'id') },
  async (c) => {
    const service = container.resolve(NodesService);
    const user = c.get('user')!;
    const id = c.req.param('id')!;
    const input = UpdateNodeServiceCreationLockSchema.parse(await c.req.json());
    const node = await service.updateServiceCreationLock(id, input, user.id);
    return c.json({ data: node });
  }
);

nodesRoutes.openapi({ ...deleteNodeRoute, middleware: requireScopeForResource('nodes:delete', 'id') }, async (c) => {
  const service = container.resolve(NodesService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  await service.remove(id, user.id);
  return c.json({ success: true });
});

// Helper: check node type is nginx before nginx-specific operations
async function requireNginxNode(c: any): Promise<boolean> {
  const service = container.resolve(NodesService);
  const id = c.req.param('id')!;
  try {
    const node = await service.get(id);
    if (node.type !== 'nginx') {
      c.json({ code: 'NOT_NGINX', message: 'This operation is only available for nginx nodes' }, 400);
      return false;
    }
    return true;
  } catch {
    return true; // let the downstream handler produce the 404
  }
}

nodesRoutes.openapi({ ...getNodeConfigRoute, middleware: sessionOnly }, async (c) => {
  const requiredScope = `nodes:config:view:${c.req.param('id')!}`;
  if (!hasScope(c.get('effectiveScopes') || [], requiredScope)) {
    return c.json({ message: `Missing required scope: ${requiredScope}` }, 403);
  }
  if (!(await requireNginxNode(c))) return c.body(null);
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id')!;
  const result = await dispatch.readGlobalConfig(nodeId);
  if (!result.success) {
    return c.json({ code: 'DISPATCH_ERROR', message: result.error || 'Failed to read config' }, 502);
  }
  return c.json({ data: { content: result.detail } });
});

nodesRoutes.openapi({ ...updateNodeConfigRoute, middleware: sessionOnly }, async (c) => {
  const requiredScope = `nodes:config:edit:${c.req.param('id')!}`;
  if (!hasScope(c.get('effectiveScopes') || [], requiredScope)) {
    return c.json({ message: `Missing required scope: ${requiredScope}` }, 403);
  }
  if (!(await requireNginxNode(c))) return c.body(null);
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id')!;
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

// Test node's nginx config on the target node daemon.
// Do not run a backend-local nginx -t first, because node configs can contain
// valid host-specific includes/paths that do not exist inside the Gateway container.
nodesRoutes.openapi({ ...testNodeConfigRoute, middleware: sessionOnly }, async (c) => {
  const requiredScope = `nodes:config:edit:${c.req.param('id')!}`;
  if (!hasScope(c.get('effectiveScopes') || [], requiredScope)) {
    return c.json({ message: `Missing required scope: ${requiredScope}` }, 403);
  }
  if (!(await requireNginxNode(c))) return c.body(null);
  const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
  const dispatch = container.resolve(NodeDispatchService);
  const nodeId = c.req.param('id')!;
  await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });

  // Remote test via daemon (tests the deployed config in the node environment)
  const result = await dispatch.testConfig(nodeId);
  return c.json({ data: { valid: result.success, error: result.error || undefined } });
});

// Node monitoring SSE stream — real-time health + stats at 5s intervals
nodesRoutes.openapi(
  { ...nodeMonitoringStreamRoute, middleware: requireScopeForResource('nodes:details', 'id') },
  async (c) => {
    const nodeId = c.req.param('id')!;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
      return c.json({ code: 'INVALID_ID', message: 'Invalid node ID' }, 400);
    }

    const monitoringService = container.resolve(NodeMonitoringService);

    return streamSSE(c, async (stream) => {
      monitoringService.registerClient(nodeId);

      const history = monitoringService.getHistory(nodeId);
      await stream.writeSSE({
        data: JSON.stringify({ connected: true, nodeId, history: history.map(compactMonitoringHistorySnapshot) }),
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
  }
);

// Daemon logs SSE stream for a specific node
// Query params: ?level=info,warn,error  &search=keyword
nodesRoutes.openapi({ ...nodeDaemonLogsRoute, middleware: requireScopeForResource('nodes:logs', 'id') }, async (c) => {
  const nodeId = c.req.param('id')!;
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
nodesRoutes.openapi({ ...nodeNginxLogsRoute, middleware: requireScopeForResource('nodes:logs', 'id') }, async (c) => {
  if (!(await requireNginxNode(c))) return c.body(null);
  const nodeId = c.req.param('id')!;
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
  const scopes = c.get('effectiveScopes') || [];
  const hosts = await db.select({ id: proxyHosts.id }).from(proxyHosts).where(eq(proxyHosts.nodeId, nodeId));
  const visibleHostIds = new Set(
    hosts
      .map((h: any) => h.id as string)
      .filter((hostId: string) => hasScope(scopes, 'proxy:view') || hasScope(scopes, `proxy:view:${hostId}`))
  );

  const matchesFilter = (entry: RelayedLogEntry): boolean => {
    if (!visibleHostIds.has(entry.hostId)) return false;
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
      data: JSON.stringify({ connected: true, nodeId, hostCount: visibleHostIds.size }),
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
