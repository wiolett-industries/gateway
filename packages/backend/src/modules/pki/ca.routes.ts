import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { CAService } from './ca.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { ExportService } from './export.service.js';
import { OCSPService } from './ocsp.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { CreateRootCASchema, CreateIntermediateCASchema, RevokeCASchema, ExportCAKeySchema, UpdateCASchema } from './ca.schemas.js';
import type { AppEnv } from '@/types.js';

export const caRoutes = new OpenAPIHono<AppEnv>();

caRoutes.use('*', authMiddleware);

// List CAs (tree)
caRoutes.get('/', async (c) => {
  const caService = container.resolve(CAService);
  const tree = await caService.getCATree();
  return c.json(tree);
});

// Get CA detail
caRoutes.get('/:id', async (c) => {
  const caService = container.resolve(CAService);
  const id = c.req.param('id');
  const ca = await caService.getCA(id);
  return c.json(ca);
});

// Create root CA (admin only)
caRoutes.post('/', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateRootCASchema.parse(body);
  const ca = await caService.createRootCA(input, user.id);
  return c.json(ca, 201);
});

// Create intermediate CA (admin only)
caRoutes.post('/:id/intermediate', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const user = c.get('user')!;
  const parentId = c.req.param('id');
  const body = await c.req.json();
  const input = CreateIntermediateCASchema.parse(body);
  const ca = await caService.createIntermediateCA(parentId, input, user.id);
  return c.json(ca, 201);
});

// Update CA settings (admin only)
caRoutes.put('/:id', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateCASchema.parse(body);
  const ca = await caService.updateCA(id, input, user.id);
  return c.json(ca);
});

// Revoke CA (admin only)
caRoutes.post('/:id/revoke', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { reason } = RevokeCASchema.parse(body);
  await caService.revokeCA(id, reason, user.id);
  return c.json({ message: 'CA revoked' });
});

// Delete CA (admin only)
caRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await caService.deleteCA(id, user.id);
  return c.body(null, 204);
});

// Export CA private key (admin only)
caRoutes.post('/:id/export-key', rbacMiddleware('admin'), async (c) => {
  const caService = container.resolve(CAService);
  const cryptoService = container.resolve(CryptoService);
  const exportService = container.resolve(ExportService);
  const auditService = container.resolve(AuditService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { passphrase } = ExportCAKeySchema.parse(body);

  const { ca, privateKeyPem } = await caService.getCASigningMaterials(id);
  const p12 = exportService.exportCAKey(privateKeyPem, ca.certificatePem, passphrase);

  await auditService.log({
    userId: user.id,
    action: 'ca.export_key',
    resourceType: 'ca',
    resourceId: id,
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: c.req.header('user-agent'),
  });

  return new Response(p12, {
    headers: {
      'Content-Type': 'application/x-pkcs12',
      'Content-Disposition': `attachment; filename="${ca.commonName}.p12"`,
    },
  });
});

// Generate OCSP responder cert (admin only)
caRoutes.post('/:id/ocsp-responder', rbacMiddleware('admin'), async (c) => {
  const ocspService = container.resolve(OCSPService);
  const id = c.req.param('id');
  await ocspService.generateOCSPResponderCert(id);
  return c.json({ message: 'OCSP responder certificate generated' });
});
