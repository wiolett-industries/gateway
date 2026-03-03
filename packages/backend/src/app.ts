import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import { errorHandler } from '@/middleware/error-handler.js';
import { loggerMiddleware } from '@/middleware/logger.js';
import { rateLimitMiddleware } from '@/middleware/rate-limit.js';

import { authRoutes } from '@/modules/auth/auth.routes.js';
import { caRoutes } from '@/modules/pki/ca.routes.js';
import { certRoutes } from '@/modules/pki/cert.routes.js';
import { templateRoutes } from '@/modules/pki/templates.routes.js';
import { publicPkiRoutes } from '@/modules/pki/public.routes.js';
import { tokensRoutes } from '@/modules/tokens/tokens.routes.js';
import { auditRoutes } from '@/modules/audit/audit.routes.js';
import { alertRoutes } from '@/modules/audit/alert.routes.js';
import { adminRoutes } from '@/modules/admin/admin.routes.js';

import type { AppEnv } from '@/types.js';

export function createApp() {
  const app = new OpenAPIHono<AppEnv>();

  // Global middleware
  app.use('*', requestId());
  app.use('*', loggerMiddleware);
  app.use('*', secureHeaders());
  app.use('*', cors({
    origin: (origin) => origin || '*',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
    maxAge: 86400,
  }));

  // Rate limiting for API routes
  app.use('/api/*', rateLimitMiddleware);

  // Error handler
  app.onError(errorHandler);

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Public PKI endpoints (no auth) — CRL, OCSP, CA cert download
  app.route('/pki', publicPkiRoutes);

  // Auth routes
  app.route('/auth', authRoutes);

  // Protected API routes
  app.route('/api/cas', caRoutes);
  app.route('/api/certificates', certRoutes);
  app.route('/api/templates', templateRoutes);
  app.route('/api/audit', auditRoutes);
  app.route('/api/alerts', alertRoutes);
  app.route('/api/tokens', tokensRoutes);
  app.route('/api/admin', adminRoutes);

  // OpenAPI documentation
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'CA Manager API',
      version: '1.0.0',
      description: 'Self-hosted Certificate Authority management API.\n\n## Authentication\n\nThis API uses session-based authentication via OIDC. After logging in through `/auth/login`, include the session ID as a Bearer token in the Authorization header.\n\nAlternatively, use API tokens for programmatic access.\n\n## Public PKI Endpoints\n\nCRL and OCSP endpoints under `/pki/` are unauthenticated and publicly accessible.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    tags: [
      { name: 'Authentication', description: 'User authentication via OIDC' },
      { name: 'Certificate Authorities', description: 'CA creation and management' },
      { name: 'Certificates', description: 'Certificate issuance, revocation, and export' },
      { name: 'Templates', description: 'Certificate template management' },
      { name: 'PKI', description: 'Public PKI endpoints (CRL, OCSP)' },
      { name: 'Audit', description: 'Audit log' },
      { name: 'Alerts', description: 'Expiry alerts and notifications' },
      { name: 'Tokens', description: 'API token management' },
      { name: 'Admin', description: 'User administration' },
    ],
  });

  // Scalar API Reference UI
  app.get('/docs', apiReference({
    spec: { url: '/openapi.json' },
    theme: 'default',
    layout: 'modern',
  }));

  return app;
}
