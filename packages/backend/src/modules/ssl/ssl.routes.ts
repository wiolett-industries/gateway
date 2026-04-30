import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { hasScope } from '@/lib/permissions.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  deleteSslCertificateRoute,
  getSslCertificateRoute,
  linkInternalSslCertificateRoute,
  listSslCertificatesRoute,
  renewSslCertificateRoute,
  requestAcmeCertificateRoute,
  uploadSslCertificateRoute,
  verifyDnsSslCertificateRoute,
} from './ssl.docs.js';
import {
  LinkInternalCertSchema,
  RequestACMECertSchema,
  SSLCertListQuerySchema,
  UploadCertSchema,
} from './ssl.schemas.js';
import { SSLService } from './ssl.service.js';

export const sslRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

sslRoutes.use('*', authMiddleware);

// List SSL certificates (paginated, filterable)
sslRoutes.openapi({ ...listSslCertificatesRoute, middleware: requireScope('ssl:cert:list') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const query = SSLCertListQuerySchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    type: c.req.query('type'),
    status: c.req.query('status'),
    search: c.req.query('search'),
    showSystem: c.req.query('showSystem'),
  });
  const scopes = c.get('effectiveScopes') || [];
  if (query.showSystem && !hasScope(scopes, 'admin:details:certificates')) {
    return c.json({ code: 'FORBIDDEN', message: 'Insufficient permissions' }, 403);
  }
  const result = await sslService.listCerts(query);
  return c.json(result);
});

// Get SSL certificate detail
sslRoutes.openapi({ ...getSslCertificateRoute, middleware: requireScope('ssl:cert:view') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const id = c.req.param('id')!;
  const cert = await sslService.getCert(id);
  return c.json({ data: cert });
});

// Request ACME certificate
sslRoutes.openapi({ ...requestAcmeCertificateRoute, middleware: requireScope('ssl:cert:issue') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = RequestACMECertSchema.parse(body);
  const result = await sslService.requestACMECert(input, user.id);
  return c.json({ data: result }, 201);
});

// Upload certificate
sslRoutes.openapi({ ...uploadSslCertificateRoute, middleware: requireScope('ssl:cert:issue') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = UploadCertSchema.parse(body);
  const cert = await sslService.uploadCert(input, user.id);
  return c.json({ data: cert }, 201);
});

// Link internal CA certificate
sslRoutes.openapi({ ...linkInternalSslCertificateRoute, middleware: requireScope('ssl:cert:issue') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = LinkInternalCertSchema.parse(body);
  const cert = await sslService.linkInternalCert(input, user.id);
  return c.json({ data: cert }, 201);
});

// Manual renew
sslRoutes.openapi({ ...renewSslCertificateRoute, middleware: requireScope('ssl:cert:issue') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const cert = await sslService.renewCert(id, user.id);
  return c.json({ data: cert });
});

// Complete DNS-01 verification
sslRoutes.openapi({ ...verifyDnsSslCertificateRoute, middleware: requireScope('ssl:cert:issue') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const cert = await sslService.completeDNS01Verification(id, user.id);
  return c.json({ data: cert });
});

// Delete SSL certificate
sslRoutes.openapi({ ...deleteSslCertificateRoute, middleware: requireScope('ssl:cert:delete') }, async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  await sslService.deleteCert(id, user.id);
  return c.body(null, 204);
});
