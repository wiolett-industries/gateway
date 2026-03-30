import { timingSafeEqual, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { getEnv } from '@/config/env.js';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import type { AppEnv } from '@/types.js';
import { SetupService } from './setup.service.js';

const logger = createChildLogger('SetupRoutes');

export const setupRoutes = new Hono<AppEnv>();

function verifySetupToken(authHeader: string | undefined): boolean {
  const env = getEnv();
  if (!env.SETUP_TOKEN) return false;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token) return false;
  try {
    const a = createHmac('sha256', 'setup-token-verify').update(token).digest();
    const b = createHmac('sha256', 'setup-token-verify').update(env.SETUP_TOKEN).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * POST /api/setup/management-ssl
 *
 * Bootstrap the management domain with ACME SSL.
 * Protected by SETUP_TOKEN (not session auth).
 * Idempotent — safe to call multiple times.
 */
setupRoutes.post('/management-ssl', async (c) => {
  if (!verifySetupToken(c.req.header('Authorization'))) {
    return c.json({ error: 'Invalid or missing setup token' }, 401);
  }

  const body = await c.req.json<{ domain: string }>();
  if (!body.domain || typeof body.domain !== 'string') {
    return c.json({ error: 'Missing domain' }, 400);
  }

  const domain = body.domain.toLowerCase().trim();
  if (domain === 'localhost' || !domain.includes('.')) {
    return c.json({ error: 'Must be a fully qualified domain name' }, 400);
  }

  const env = getEnv();
  const provider = env.ACME_STAGING ? 'letsencrypt-staging' : 'letsencrypt';

  try {
    const setupService = container.resolve(SetupService);
    const result = await setupService.bootstrapManagementSSL(domain, provider);
    logger.info('Management SSL bootstrap successful', result);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Management SSL bootstrap failed', { domain, error: message });
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/setup/management-ssl-upload
 *
 * Bootstrap with a BYO (bring-your-own) certificate.
 * Accepts PEM cert + key directly.
 */
setupRoutes.post('/management-ssl-upload', async (c) => {
  if (!verifySetupToken(c.req.header('Authorization'))) {
    return c.json({ error: 'Invalid or missing setup token' }, 401);
  }

  const body = await c.req.json<{
    domain: string;
    certificatePem: string;
    privateKeyPem: string;
    chainPem?: string;
  }>();

  if (!body.domain || !body.certificatePem || !body.privateKeyPem) {
    return c.json({ error: 'Missing domain, certificatePem, or privateKeyPem' }, 400);
  }

  const domain = body.domain.toLowerCase().trim();
  if (domain === 'localhost' || !domain.includes('.')) {
    return c.json({ error: 'Must be a fully qualified domain name' }, 400);
  }

  try {
    const setupService = container.resolve(SetupService);
    const result = await setupService.bootstrapManagementSSLUpload(
      domain,
      body.certificatePem,
      body.privateKeyPem,
      body.chainPem
    );
    logger.info('Management SSL (BYO cert) bootstrap successful', result);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Management SSL (BYO cert) bootstrap failed', { domain, error: message });
    return c.json({ error: message }, 500);
  }
});
