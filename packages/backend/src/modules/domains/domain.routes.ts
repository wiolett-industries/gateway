import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { SSLService } from '@/modules/ssl/ssl.service.js';
import type { AppEnv } from '@/types.js';
import { CreateDomainSchema, DomainListQuerySchema, UpdateDomainSchema } from './domain.schemas.js';
import { DomainsService } from './domain.service.js';

export const domainRoutes = new OpenAPIHono<AppEnv>();

domainRoutes.use('*', authMiddleware);
domainRoutes.use('*', sessionOnly);

// List domains (paginated)
domainRoutes.get('/', requireScope('proxy:list'), async (c) => {
  const domainsService = container.resolve(DomainsService);
  const query = DomainListQuerySchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    search: c.req.query('search'),
    dnsStatus: c.req.query('dnsStatus'),
  });
  const result = await domainsService.listDomains(query);
  return c.json(result);
});

// Autocomplete search (must be before /:id)
domainRoutes.get('/search', requireScope('proxy:list'), async (c) => {
  const domainsService = container.resolve(DomainsService);
  const q = c.req.query('q') || '';
  if (q.length < 1) return c.json({ data: [] });
  const results = await domainsService.searchDomains(q);
  return c.json({ data: results });
});

// Get domain detail with usage
domainRoutes.get('/:id', requireScope('proxy:list'), async (c) => {
  const domainsService = container.resolve(DomainsService);
  try {
    const domain = await domainsService.getDomain(c.req.param('id'));
    return c.json({ data: domain });
  } catch {
    return c.json({ code: 'NOT_FOUND', message: 'Domain not found' }, 404);
  }
});

// Create domain
domainRoutes.post('/', requireScope('proxy:edit'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateDomainSchema.parse(body);
  const domainsService = container.resolve(DomainsService);
  try {
    const domain = await domainsService.createDomain(input, user.id);
    return c.json({ data: domain }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create domain';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ code: 'DUPLICATE', message: 'Domain already exists' }, 409);
    }
    return c.json({ code: 'ERROR', message: msg }, 400);
  }
});

// Update domain
domainRoutes.put('/:id', requireScope('proxy:edit'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = UpdateDomainSchema.parse(body);
  const domainsService = container.resolve(DomainsService);
  try {
    const domain = await domainsService.updateDomain(c.req.param('id'), input, user.id);
    return c.json({ data: domain });
  } catch {
    return c.json({ code: 'NOT_FOUND', message: 'Domain not found' }, 404);
  }
});

// Delete domain
domainRoutes.delete('/:id', requireScope('proxy:delete'), async (c) => {
  const user = c.get('user')!;
  const domainsService = container.resolve(DomainsService);
  try {
    await domainsService.deleteDomain(c.req.param('id'), user.id);
    return c.json({ data: { success: true } });
  } catch {
    return c.json({ code: 'NOT_FOUND', message: 'Domain not found' }, 404);
  }
});

// Manual DNS check
domainRoutes.post('/:id/check-dns', requireScope('proxy:edit'), async (c) => {
  const domainsService = container.resolve(DomainsService);
  try {
    const domain = await domainsService.checkDns(c.req.param('id'));
    return c.json({ data: domain });
  } catch {
    return c.json({ code: 'NOT_FOUND', message: 'Domain not found' }, 404);
  }
});

// Issue ACME cert for domain
domainRoutes.post('/:id/issue-cert', requireScope('proxy:edit'), async (c) => {
  const user = c.get('user')!;
  const domainsService = container.resolve(DomainsService);
  const sslService = container.resolve(SSLService);

  let domainRow: Awaited<ReturnType<DomainsService['getDomain']>> | undefined;
  try {
    domainRow = await domainsService.getDomain(c.req.param('id'));
  } catch {
    return c.json({ code: 'NOT_FOUND', message: 'Domain not found' }, 404);
  }

  try {
    const cert = await sslService.requestACMECert(
      {
        domains: [domainRow.domain],
        challengeType: 'http-01',
        provider: 'letsencrypt',
        autoRenew: true,
      },
      user.id
    );
    return c.json({ data: cert }, 201);
  } catch (err) {
    return c.json({ code: 'CERT_ERROR', message: err instanceof Error ? err.message : 'Failed to issue cert' }, 400);
  }
});
