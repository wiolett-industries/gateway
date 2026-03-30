import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { sanitizeFilename } from '@/lib/utils.js';
import { authMiddleware, rbacMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { CAService } from './ca.service.js';
import {
  CertificateListQuerySchema,
  ExportCertificateQuerySchema,
  IssueCertFromCSRSchema,
  IssueCertificateSchema,
  RevokeCertificateSchema,
} from './cert.schemas.js';
import { CertService } from './cert.service.js';
import { CRLService } from './crl.service.js';
import { ExportService } from './export.service.js';
import { OCSPService } from './ocsp.service.js';

export const certRoutes = new OpenAPIHono<AppEnv>();

certRoutes.use('*', authMiddleware);

// List certificates (paginated, filterable)
certRoutes.get('/', requireScope('cert:read'), async (c) => {
  const certService = container.resolve(CertService);
  const query = CertificateListQuerySchema.parse({
    caId: c.req.query('caId'),
    status: c.req.query('status'),
    type: c.req.query('type'),
    search: c.req.query('search'),
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    sortBy: c.req.query('sortBy'),
    sortOrder: c.req.query('sortOrder'),
  });
  const result = await certService.listCertificates(query);
  return c.json(result);
});

// Get certificate detail
certRoutes.get('/:id', requireScope('cert:read'), async (c) => {
  const certService = container.resolve(CertService);
  const id = c.req.param('id');
  const cert = await certService.getCertificate(id);
  return c.json(cert);
});

// Issue certificate (server-side key generation)
certRoutes.post('/', rbacMiddleware('admin', 'operator'), requireScope('cert:issue'), async (c) => {
  const certService = container.resolve(CertService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = IssueCertificateSchema.parse(body);
  const result = await certService.issueCertificate(input, user.id);
  return c.json(result, 201);
});

// Issue certificate from CSR
certRoutes.post('/from-csr', rbacMiddleware('admin', 'operator'), requireScope('cert:issue'), async (c) => {
  const certService = container.resolve(CertService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = IssueCertFromCSRSchema.parse(body);
  const cert = await certService.issueCertificateFromCSR(input, user.id);
  return c.json(cert, 201);
});

// Revoke certificate
certRoutes.post('/:id/revoke', rbacMiddleware('admin', 'operator'), requireScope('cert:revoke'), async (c) => {
  const certService = container.resolve(CertService);
  const crlService = container.resolve(CRLService);
  const _ocspService = container.resolve(OCSPService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { reason } = RevokeCertificateSchema.parse(body);

  const caId = await certService.revokeCertificate(id, reason, user.id);

  // Regenerate CRL for the issuing CA
  await crlService.generateCRL(caId);

  return c.json({ message: 'Certificate revoked' });
});

// Export certificate
certRoutes.post('/:id/export', requireScope('cert:export'), async (c) => {
  const certService = container.resolve(CertService);
  const exportService = container.resolve(ExportService);
  const id = c.req.param('id');
  const body = await c.req.json();
  const { format, passphrase } = ExportCertificateQuerySchema.parse(body);

  const cert = await certService.getCertificate(id);

  switch (format) {
    case 'pem':
      return new Response(cert.certificatePem, {
        headers: {
          'Content-Type': 'application/x-pem-file',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(cert.commonName)}.pem"`,
        },
      });

    case 'der': {
      const der = exportService.exportDER(cert.certificatePem);
      return new Response(der, {
        headers: {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(cert.commonName)}.der"`,
        },
      });
    }

    case 'pkcs12': {
      if (!passphrase) {
        return c.json({ code: 'PASSPHRASE_REQUIRED', message: 'Passphrase required for PKCS#12 export' }, 400);
      }
      const privateKey = await certService.getCertificatePrivateKey(id);
      if (!privateKey) {
        return c.json({ code: 'NO_PRIVATE_KEY', message: 'Private key not available (CSR-based certificate)' }, 400);
      }
      const p12 = exportService.exportPKCS12(cert.certificatePem, privateKey, passphrase);
      return new Response(p12, {
        headers: {
          'Content-Type': 'application/x-pkcs12',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(cert.commonName)}.p12"`,
        },
      });
    }

    case 'jks': {
      if (!passphrase) {
        return c.json({ code: 'PASSPHRASE_REQUIRED', message: 'Passphrase required for JKS export' }, 400);
      }
      const jksKey = await certService.getCertificatePrivateKey(id);
      const jks = exportService.exportJKS(cert.certificatePem, jksKey, passphrase, cert.commonName);
      return new Response(jks, {
        headers: {
          'Content-Type': 'application/x-java-keystore',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(cert.commonName)}.jks"`,
        },
      });
    }
  }
});

// Download certificate chain
certRoutes.get('/:id/chain', requireScope('cert:read'), async (c) => {
  const certService = container.resolve(CertService);
  const caService = container.resolve(CAService);
  const exportService = container.resolve(ExportService);
  const id = c.req.param('id');

  const cert = await certService.getCertificate(id);

  // Build chain by walking up the CA hierarchy
  const chainPems: string[] = [];
  let currentCaId: string | null = cert.caId;

  while (currentCaId) {
    const ca = await caService.getCA(currentCaId);
    chainPems.push(ca.certificatePem);
    currentCaId = ca.parentId;
  }

  const fullChain = exportService.exportPEM(cert.certificatePem, chainPems);

  return new Response(fullChain, {
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(cert.commonName)}-chain.pem"`,
    },
  });
});
