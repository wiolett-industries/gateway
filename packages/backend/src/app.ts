import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import { getEnv, isDevelopment } from '@/config/env.js';
import { container } from '@/container.js';
import { tags as openApiTags, openApiValidationHook, securitySchemes } from '@/lib/openapi.js';
import { auditContextMiddleware } from '@/middleware/audit-context.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { loggerMiddleware } from '@/middleware/logger.js';
import {
  aiWebSocketRateLimitMiddleware,
  authCallbackRateLimitMiddleware,
  authLoginRateLimitMiddleware,
  authRateLimitMiddleware,
  pkiRateLimitMiddleware,
  publicStatusRateLimitMiddleware,
  publicWebhookRateLimitMiddleware,
  rateLimitMiddleware,
  setupRateLimitMiddleware,
  streamRateLimitMiddleware,
} from '@/middleware/rate-limit.js';
import { accessListRoutes } from '@/modules/access-lists/access-list.routes.js';
import { adminRoutes } from '@/modules/admin/admin.routes.js';
import { aiRoutes } from '@/modules/ai/ai.routes.js';
import { authenticateWSConnection, createWSHandlers } from '@/modules/ai/ai.ws.js';
import { alertRoutes } from '@/modules/audit/alert.routes.js';
import { auditRoutes } from '@/modules/audit/audit.routes.js';
import { authMiddleware, requireActiveUser, SESSION_COOKIE_NAME } from '@/modules/auth/auth.middleware.js';
import { authRoutes } from '@/modules/auth/auth.routes.js';
import { databaseRoutes } from '@/modules/databases/databases.routes.js';
import { dockerRoutes } from '@/modules/docker/docker.routes.js';
import { createComposeLogsWSHandlers } from '@/modules/docker/docker-compose-logs.ws.js';
import { createDockerExecWSHandlers } from '@/modules/docker/docker-exec.ws.js';
import { createDockerLogStreamWSHandlers } from '@/modules/docker/docker-logs.ws.js';
import { dockerWebhookTriggerRoutes } from '@/modules/docker/docker-webhook.routes.js';
import { domainRoutes } from '@/modules/domains/domain.routes.js';
import { groupRoutes } from '@/modules/groups/group.routes.js';
import { housekeepingRoutes } from '@/modules/housekeeping/housekeeping.routes.js';
import { licenseRoutes } from '@/modules/license/license.routes.js';
import { loggingRoutes } from '@/modules/logging/logging.routes.js';
import { monitoringRoutes } from '@/modules/monitoring/monitoring.routes.js';
import { createNodeExecWSHandlers } from '@/modules/nodes/node-exec.ws.js';
import { nodesRoutes } from '@/modules/nodes/nodes.routes.js';
import { notificationRoutes } from '@/modules/notifications/notification.routes.js';
import { caRoutes } from '@/modules/pki/ca.routes.js';
import { certRoutes } from '@/modules/pki/cert.routes.js';
import { publicPkiRoutes } from '@/modules/pki/public.routes.js';
import { templateRoutes } from '@/modules/pki/templates.routes.js';
import { folderRoutes } from '@/modules/proxy/folder.routes.js';
import { nginxTemplateRoutes } from '@/modules/proxy/nginx-template.routes.js';
import { proxyRoutes } from '@/modules/proxy/proxy.routes.js';
import { setupRoutes } from '@/modules/setup/setup.routes.js';
import { sslRoutes } from '@/modules/ssl/ssl.routes.js';
import { publicStatusPageRoutes, statusPageRoutes } from '@/modules/status-page/status-page.routes.js';
import { StatusPageService } from '@/modules/status-page/status-page.service.js';
import { systemRoutes } from '@/modules/system/system.routes.js';
import { tokensRoutes } from '@/modules/tokens/tokens.routes.js';
import type { AppEnv } from '@/types.js';
import { authenticateEventsConnection, createEventsWSHandlers } from '@/ws/events.ws.js';

const STATUS_PREVIEW_PREFIX = '/_status-preview';

const requireAnyEffectiveScope: MiddlewareHandler<AppEnv> = async (c, next) => {
  const scopes = c.get('effectiveScopes') ?? [];
  if (scopes.length === 0) {
    throw new HTTPException(403, { message: 'At least one permission scope is required' });
  }
  await next();
};

function getCookieValue(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=');
  }
  return '';
}

function isAllowedWebSocketOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const requestOrigin = new URL(origin).origin;
    const appOrigin = new URL(getEnv().APP_URL).origin;
    if (requestOrigin === appOrigin) return true;
    return (
      isDevelopment() && (requestOrigin.startsWith('http://localhost') || requestOrigin.startsWith('http://127.0.0.1'))
    );
  } catch {
    return false;
  }
}

function getWebSocketSessionId(cookieHeader: string | undefined, origin: string | undefined): string {
  if (!isAllowedWebSocketOrigin(origin)) return '';
  return getCookieValue(cookieHeader, SESSION_COOKIE_NAME);
}

async function isStatusHostRequest(hostHeader: string | undefined): Promise<boolean> {
  try {
    return await container.resolve(StatusPageService).isStatusHost(hostHeader);
  } catch {
    return false;
  }
}

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

  // WebSocket support for AI assistant
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any });

  // Global middleware
  app.use('*', requestId());
  app.use('*', auditContextMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: (origin) => {
        const appOrigin = new URL(getEnv().APP_URL).origin;
        if (origin === appOrigin) return origin;
        if (
          isDevelopment() &&
          origin &&
          (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))
        ) {
          return origin;
        }
        return '';
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
      exposeHeaders: ['X-Request-ID'],
      maxAge: 86400,
    })
  );

  // Rate limiting for API and public PKI routes
  app.use('/api/*', rateLimitMiddleware);
  app.use('/pki/*', rateLimitMiddleware);
  app.use('/auth/*', authRateLimitMiddleware);
  app.use('/auth/login', authLoginRateLimitMiddleware);
  app.use('/auth/callback', authCallbackRateLimitMiddleware);
  app.use('/pki/*', pkiRateLimitMiddleware);
  app.use('/api/public/status-page', publicStatusRateLimitMiddleware);
  app.use('/api/webhooks/docker/*', publicWebhookRateLimitMiddleware);
  app.use('/api/setup/*', setupRateLimitMiddleware);
  app.use('/api/ai/ws', aiWebSocketRateLimitMiddleware);
  app.use('/api/events', streamRateLimitMiddleware);
  app.use('/api/docker/nodes/:nodeId/containers/:containerId/exec', streamRateLimitMiddleware);
  app.use('/api/nodes/:nodeId/exec', streamRateLimitMiddleware);
  app.use('/api/docker/nodes/:nodeId/containers/:containerId/logs/stream', streamRateLimitMiddleware);
  app.use('/api/docker/nodes/:nodeId/compose/:project/logs/stream', streamRateLimitMiddleware);

  // Safely no-ops when user is not set (unauthenticated); route-level authMiddleware handles 401
  app.use('/api/*', requireActiveUser);

  // Error handler
  app.onError(errorHandler);

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('*', async (c, next) => {
    const statusHost = await isStatusHostRequest(c.req.header('host'));
    if (!statusHost) {
      await next();
      return;
    }

    const path = new URL(c.req.url).pathname;
    if (path === '/api/public/status-page') {
      await next();
      return;
    }

    if (
      path.startsWith('/api/') ||
      path.startsWith('/auth/') ||
      path.startsWith('/pki/') ||
      path.startsWith('/docs') ||
      path === '/openapi.json' ||
      path === '/health' ||
      path.startsWith(STATUS_PREVIEW_PREFIX)
    ) {
      return c.notFound();
    }

    await next();
  });

  // Public PKI endpoints (no auth) — CRL, OCSP, CA cert download
  app.route('/pki', publicPkiRoutes);
  app.route('/api/public/status-page', publicStatusPageRoutes);

  // Auth routes
  app.route('/auth', authRoutes);

  // Protected API routes
  app.route('/api/cas', caRoutes);
  app.route('/api/certificates', certRoutes);
  app.route('/api/templates', templateRoutes);
  app.route('/api/audit', auditRoutes);
  app.route('/api/alerts', alertRoutes);
  app.route('/api/tokens', tokensRoutes);
  app.route('/api/admin/groups', groupRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/docker', dockerRoutes);
  app.route('/api/databases', databaseRoutes);
  app.route('/api/webhooks/docker', dockerWebhookTriggerRoutes);
  app.route('/api/nodes', nodesRoutes);
  app.route('/api/proxy-hosts', proxyRoutes);
  app.route('/api/proxy-host-folders', folderRoutes);
  app.route('/api/nginx-templates', nginxTemplateRoutes);
  app.route('/api/ssl-certificates', sslRoutes);
  app.route('/api/domains', domainRoutes);
  app.route('/api/access-lists', accessListRoutes);
  app.route('/api/monitoring', monitoringRoutes);
  app.route('/api/setup', setupRoutes);
  app.route('/api/status-page', statusPageRoutes);
  app.route('/api/system/license', licenseRoutes);
  app.route('/api/system', systemRoutes);
  app.route('/api/housekeeping', housekeepingRoutes);
  app.route('/api/notifications', notificationRoutes);
  app.route('/api/logging', loggingRoutes);
  app.route('/api/ai', aiRoutes);

  // AI WebSocket endpoint
  const wsHandlers = createWSHandlers();
  app.get(
    '/api/ai/ws',
    upgradeWebSocket((c) => {
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return {
        onOpen(event, ws) {
          wsHandlers.onOpen(event, ws);
          // Authenticate after connection opens
          authenticateWSConnection(ws, sessionId).catch(() => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          });
        },
        onMessage: wsHandlers.onMessage,
        onClose: wsHandlers.onClose,
        onError: wsHandlers.onError,
      };
    })
  );

  // Docker exec WebSocket endpoint
  app.get(
    '/api/docker/nodes/:nodeId/containers/:containerId/exec',
    upgradeWebSocket((c) => {
      const nodeId = c.req.param('nodeId') ?? '';
      const containerId = c.req.param('containerId') ?? '';
      const shell = c.req.query('shell') || '/bin/sh';
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return createDockerExecWSHandlers(nodeId, containerId, shell, sessionId);
    })
  );

  // Node-level console WebSocket endpoint
  app.get(
    '/api/nodes/:nodeId/exec',
    upgradeWebSocket((c) => {
      const nodeId = c.req.param('nodeId') ?? '';
      const shell = c.req.query('shell') || 'auto';
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return createNodeExecWSHandlers(nodeId, shell, sessionId);
    })
  );

  // Docker log stream WebSocket endpoint
  app.get(
    '/api/docker/nodes/:nodeId/containers/:containerId/logs/stream',
    upgradeWebSocket((c) => {
      const nodeId = c.req.param('nodeId') ?? '';
      const containerId = c.req.param('containerId') ?? '';
      const tail = Number(c.req.query('tail')) || 100;
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return createDockerLogStreamWSHandlers(nodeId, containerId, tail, sessionId);
    })
  );

  // Realtime events WebSocket — single channel for all push notifications
  const eventsHandlers = createEventsWSHandlers();
  app.get(
    '/api/events',
    upgradeWebSocket((c) => {
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return {
        onOpen(event, ws) {
          eventsHandlers.onOpen(event, ws);
          authenticateEventsConnection(ws, sessionId).catch(() => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          });
        },
        onMessage: eventsHandlers.onMessage,
        onClose: eventsHandlers.onClose,
        onError: eventsHandlers.onError,
      };
    })
  );

  // Docker compose logs WebSocket endpoint
  app.get(
    '/api/docker/nodes/:nodeId/compose/:project/logs/stream',
    upgradeWebSocket((c) => {
      const nodeId = c.req.param('nodeId') ?? '';
      const project = decodeURIComponent(c.req.param('project') ?? '');
      const sessionId = getWebSocketSessionId(c.req.header('cookie'), c.req.header('origin'));
      return createComposeLogsWSHandlers(nodeId, project, sessionId);
    })
  );

  // OpenAPI documentation
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', securitySchemes.bearerAuth as any);
  app.use('/openapi.json', authMiddleware, requireActiveUser, requireAnyEffectiveScope);
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Gateway API',
      version: '1.0.0',
      description:
        'Gateway is a self-hosted control plane for managing nodes, reverse proxies, Docker workloads, certificates, databases, logging, monitoring, status pages, notifications, and operational automation.\n\n## Authentication\n\nBrowser sessions authenticate through the HttpOnly `session_id` cookie set by OIDC login. Cookie-authenticated mutating requests must include `X-CSRF-Token` from `/auth/csrf`.\n\nAPI tokens use `Authorization: Bearer gw_...` for programmatic access.\n\n## Public PKI Endpoints\n\nCRL and OCSP endpoints under `/pki/` are unauthenticated and publicly accessible.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    tags: openApiTags,
  });

  // Scalar API Reference UI
  app.use('/docs', authMiddleware, requireActiveUser, requireAnyEffectiveScope);
  app.use('/docs/*', authMiddleware, requireActiveUser, requireAnyEffectiveScope);
  app.get(
    '/docs',
    apiReference({
      spec: { url: '/openapi.json' },
      theme: 'default',
      layout: 'modern',
    })
  );

  // In production, serve the frontend SPA
  const statusPublicDir = resolve(process.cwd(), 'status-public');
  if (existsSync(statusPublicDir)) {
    const statusStaticFiles = serveStatic({ root: './status-public' });
    const statusIndexFile = serveStatic({ path: './status-public/index.html' });

    app.use(
      `${STATUS_PREVIEW_PREFIX}/*`,
      serveStatic({
        root: './status-public',
        rewriteRequestPath: (path) => path.replace(STATUS_PREVIEW_PREFIX, '') || '/',
      })
    );
    app.get(STATUS_PREVIEW_PREFIX, serveStatic({ path: './status-public/index.html' }));
    app.get(`${STATUS_PREVIEW_PREFIX}/*`, serveStatic({ path: './status-public/index.html' }));

    app.use('/*', async (c, next) => {
      if (!(await isStatusHostRequest(c.req.header('host')))) {
        await next();
        return;
      }

      const path = new URL(c.req.url).pathname;
      if (path.startsWith('/assets/') || /\.[a-zA-Z0-9]+$/.test(path)) {
        let missed = false;
        const response = await statusStaticFiles(c, async () => {
          missed = true;
        });
        return missed ? c.notFound() : response;
      }
      let missed = false;
      const response = await statusIndexFile(c, async () => {
        missed = true;
      });
      return missed ? c.notFound() : response;
    });
  }

  const publicDir = resolve(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    // Serve static assets (JS, CSS, images, etc.)
    app.use('/*', serveStatic({ root: './public' }));

    // SPA fallback — serve index.html for any non-API route
    app.get('/*', serveStatic({ path: './public/index.html' }));
  }

  return { app, injectWebSocket };
}
