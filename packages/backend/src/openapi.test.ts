import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/auth/auth.middleware.js', () => {
  const scopedUser = {
    id: 'user-1',
    oidcSubject: 'oidc:user-1',
    email: 'docs@example.com',
    name: 'Docs User',
    avatarUrl: null,
    groupId: 'group-1',
    groupName: 'Docs',
    scopes: ['nodes:list'],
    isBlocked: false,
  };

  const authMiddleware = async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie') ?? '';

    if (authHeader === 'Bearer gw_empty') {
      c.set('user', { ...scopedUser, scopes: [] });
      c.set('effectiveScopes', []);
      c.set('isTokenAuth', true);
      await next();
      return;
    }

    if (authHeader === 'Bearer gw_test' || cookieHeader.includes('session_id=test')) {
      c.set('user', scopedUser);
      c.set('effectiveScopes', scopedUser.scopes);
      c.set('isTokenAuth', authHeader === 'Bearer gw_test');
      await next();
      return;
    }

    return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
  };

  const requireActiveUser = async (c: any, next: any) => {
    if (c.get('user')?.isBlocked) {
      return c.json({ code: 'FORBIDDEN', message: 'Account is blocked' }, 403);
    }
    await next();
  };

  const allow = () => async (_c: any, next: any) => {
    await next();
  };

  return {
    authMiddleware,
    optionalAuthMiddleware: allow(),
    requireActiveUser,
    requireScope: allow,
    requireAnyScope: allow,
    requireScopeForResource: allow,
    sessionOnly: allow(),
    CSRF_HEADER_NAME: 'X-CSRF-Token',
    SESSION_COOKIE_NAME: 'session_id',
  };
});

function seedEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'http://localhost/db';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.OIDC_ISSUER = 'http://localhost/oidc';
  process.env.OIDC_CLIENT_ID = 'test';
  process.env.OIDC_CLIENT_SECRET = 'test';
  process.env.OIDC_REDIRECT_URI = 'http://localhost/auth/callback';
  process.env.PKI_MASTER_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
}

describe('OpenAPI documentation', () => {
  it('protects documentation routes and serves a populated OpenAPI document for Scalar', async () => {
    seedEnv();
    const { createApp } = await import('./app.js');
    const { app } = createApp();

    expect((await app.request('/openapi.json')).status).toBe(401);
    expect((await app.request('/docs')).status).toBe(401);
    expect((await app.request('/openapi.json', { headers: { Authorization: 'Bearer gw_empty' } })).status).toBe(403);

    const docsResponse = await app.request('/docs', { headers: { Cookie: 'session_id=test' } });
    expect(docsResponse.status).toBe(200);
    await expect(docsResponse.text()).resolves.toContain('/openapi.json');

    const response = await app.request('/openapi.json', { headers: { Authorization: 'Bearer gw_test' } });
    expect(response.status).toBe(200);

    const document = (await response.json()) as { paths?: Record<string, any> };
    const paths = Object.keys(document.paths ?? {});

    expect(paths.length).toBeGreaterThan(200);
    expect(paths).toContain('/api/nodes');
    expect(paths).toContain('/api/docker/nodes/{nodeId}/containers');
    expect(paths).toContain('/api/docker/nodes/{nodeId}/deployments');
    expect(paths).toContain('/api/proxy-hosts');
    expect(paths).toContain('/api/proxy-host-folders/grouped');
    expect(paths).toContain('/api/status-page/services');
    expect(paths).toContain('/api/logging/environments/{id}/search');
    expect(paths).toContain('/api/cas');
    expect(paths).toContain('/api/certificates');
    expect(paths).toContain('/api/ssl-certificates');
    expect(paths).toContain('/api/domains');
    expect(paths).toContain('/api/databases');
    expect(paths).toContain('/api/system/version');
    expect(paths).toContain('/api/notifications/webhooks');

    const nodesList = document.paths?.['/api/nodes']?.get;
    expect(Object.keys(nodesList.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409', '422', '500'])
    );
    expect(nodesList.responses['200'].content['application/json'].example).toMatchObject({
      data: [
        {
          hostname: 'edge-01',
          status: 'online',
        },
      ],
    });
    expect(nodesList.responses['400'].content['application/json'].example).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
  });
});
