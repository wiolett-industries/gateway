import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { sanitizeFilename } from '@/lib/utils.js';
import type { AppEnv } from '@/types.js';
import { CAService } from './ca.service.js';
import { CRLService } from './crl.service.js';
import { OCSPService } from './ocsp.service.js';

export const publicPkiRoutes = new OpenAPIHono<AppEnv>();

// Download CRL (DER format, no auth required)
publicPkiRoutes.get('/crl/:caId', async (c) => {
  const crlService = container.resolve(CRLService);
  const caId = c.req.param('caId');

  try {
    const crlDer = await crlService.getCRL(caId);
    return new Response(crlDer, {
      headers: {
        'Content-Type': 'application/pkix-crl',
        'Content-Disposition': `attachment; filename="${caId}.crl"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return c.json({ code: 'CRL_ERROR', message: 'Failed to retrieve CRL' }, 500);
  }
});

// OCSP responder (POST — application/ocsp-request)
publicPkiRoutes.post('/ocsp/:caId', async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 10240) {
    return c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'OCSP request too large' }, 413);
  }

  const ocspService = container.resolve(OCSPService);
  const caId = c.req.param('caId');
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 10240) {
    return c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'OCSP request too large' }, 413);
  }

  const response = await ocspService.handleOCSPRequest(caId, Buffer.from(body));

  return new Response(response, {
    headers: {
      'Content-Type': 'application/ocsp-response',
    },
  });
});

// OCSP responder (GET — base64-encoded request in URL)
publicPkiRoutes.get('/ocsp/:caId/:encodedRequest', async (c) => {
  const encodedRequest = c.req.param('encodedRequest');
  if (encodedRequest.length > 13654) {
    return c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'OCSP request too large' }, 413);
  }

  const ocspService = container.resolve(OCSPService);
  const caId = c.req.param('caId');
  const requestDer = Buffer.from(encodedRequest, 'base64');
  const response = await ocspService.handleOCSPRequest(caId, requestDer);

  return new Response(response, {
    headers: {
      'Content-Type': 'application/ocsp-response',
    },
  });
});

// Download CA certificate (PEM, no auth required)
publicPkiRoutes.get('/ca/:caId/cert', async (c) => {
  const caService = container.resolve(CAService);
  const caId = c.req.param('caId');

  try {
    const ca = await caService.getCA(caId);
    return new Response(ca.certificatePem, {
      headers: {
        'Content-Type': 'application/x-pem-file',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(ca.commonName)}.pem"`,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.json({ code: 'CA_NOT_FOUND', message: 'CA not found' }, 404);
  }
});
