import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  LinkInternalCertSchema,
  RequestACMECertSchema,
  SSLCertListQuerySchema,
  UploadCertSchema,
} from './ssl.schemas.js';
import { SSLService } from './ssl.service.js';

export const sslRoutes = new OpenAPIHono<AppEnv>();

sslRoutes.use('*', authMiddleware);
sslRoutes.use('*', sessionOnly);

// List SSL certificates (paginated, filterable)
sslRoutes.get('/', async (c) => {
  const sslService = container.resolve(SSLService);
  const query = SSLCertListQuerySchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    type: c.req.query('type'),
    status: c.req.query('status'),
    search: c.req.query('search'),
  });
  const result = await sslService.listCerts(query);
  return c.json(result);
});

// Get SSL certificate detail
sslRoutes.get('/:id', async (c) => {
  const sslService = container.resolve(SSLService);
  const id = c.req.param('id');
  const cert = await sslService.getCert(id);
  return c.json({ data: cert });
});

// Request ACME certificate (admin, operator)
sslRoutes.post('/acme', rbacMiddleware('admin', 'operator'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = RequestACMECertSchema.parse(body);
  const result = await sslService.requestACMECert(input, user.id);
  return c.json({ data: result }, 201);
});

// Upload certificate (admin, operator)
sslRoutes.post('/upload', rbacMiddleware('admin', 'operator'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = UploadCertSchema.parse(body);
  const cert = await sslService.uploadCert(input, user.id);
  return c.json({ data: cert }, 201);
});

// Link internal CA certificate (admin, operator)
sslRoutes.post('/internal', rbacMiddleware('admin', 'operator'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = LinkInternalCertSchema.parse(body);
  const cert = await sslService.linkInternalCert(input, user.id);
  return c.json({ data: cert }, 201);
});

// Manual renew (admin, operator)
sslRoutes.post('/:id/renew', rbacMiddleware('admin', 'operator'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const cert = await sslService.renewCert(id, user.id);
  return c.json({ data: cert });
});

// Complete DNS-01 verification (admin, operator)
sslRoutes.post('/:id/dns-verify', rbacMiddleware('admin', 'operator'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const cert = await sslService.completeDNS01Verification(id, user.id);
  return c.json({ data: cert });
});

// Delete SSL certificate (admin only)
sslRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const sslService = container.resolve(SSLService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await sslService.deleteCert(id, user.id);
  return c.body(null, 204);
});
