import 'reflect-metadata';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv, User } from '@/types.js';
import { integrationsRoutes } from './integrations.routes.js';
import { IntegrationsService } from './integrations.service.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [],
  isBlocked: false,
};

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route('/api/integrations', integrationsRoutes);
  return app;
}

function registerServices(scopes: string[], service: Partial<IntegrationsService>) {
  container.registerInstance(TokensService, {
    validateToken: vi.fn().mockResolvedValue({
      user: { ...USER, scopes },
      scopes,
      tokenId: 'token-1',
      tokenPrefix: 'gw_abc1234',
    }),
  } as unknown as TokensService);
  container.registerInstance(IntegrationsService, service as IntegrationsService);
}

function authHeaders() {
  return {
    Authorization: 'Bearer gw_valid',
    'Content-Type': 'application/json',
  };
}

afterEach(() => {
  container.reset();
});

describe('integrations routes', () => {
  it('requires GitLab manage scope to create connectors', async () => {
    const createGitLabConnector = vi.fn();
    registerServices(['integrations:gitlab:view'], { createGitLabConnector });

    const response = await createApp().request('/api/integrations/gitlab/connectors', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Main', baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }),
    });

    expect(response.status).toBe(403);
    expect(createGitLabConnector).not.toHaveBeenCalled();
  });

  it('creates connectors with GitLab manage scope', async () => {
    const createGitLabConnector = vi.fn().mockResolvedValue({ id: 'connector-1', tokenMasked: '****cret' });
    registerServices(['integrations:gitlab:manage'], { createGitLabConnector });

    const response = await createApp().request('/api/integrations/gitlab/connectors', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Main', baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }),
    });

    expect(response.status).toBe(201);
    expect(createGitLabConnector).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Main', baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }),
      USER.id
    );
    expect(await response.json()).toEqual({ data: { id: 'connector-1', tokenMasked: '****cret' } });
  });

  it('lists and gets connectors with GitLab view scope without raw tokens', async () => {
    const listGitLabConnectors = vi.fn().mockResolvedValue([{ id: 'connector-1', tokenMasked: '****cret' }]);
    const getGitLabConnector = vi.fn().mockResolvedValue({
      id: 'connector-1',
      tokenMasked: '****cret',
      hasToken: true,
      allowlistEntries: [],
    });
    registerServices(['integrations:gitlab:view'], { listGitLabConnectors, getGitLabConnector });

    const listResponse = await createApp().request('/api/integrations/gitlab/connectors', {
      headers: authHeaders(),
    });
    const getResponse = await createApp().request('/api/integrations/gitlab/connectors/connector-1', {
      headers: authHeaders(),
    });

    expect(listResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ data: [{ id: 'connector-1', tokenMasked: '****cret' }] });
    expect(await getResponse.json()).toEqual({
      data: { id: 'connector-1', tokenMasked: '****cret', hasToken: true, allowlistEntries: [] },
    });
  });

  it('updates connectors with GitLab manage scope using PATCH', async () => {
    const updateGitLabConnector = vi.fn().mockResolvedValue({ id: 'connector-1', name: 'Renamed' });
    registerServices(['integrations:gitlab:manage'], { updateGitLabConnector });

    const response = await createApp().request('/api/integrations/gitlab/connectors/connector-1', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Renamed', settings: { autoSyncIntervalSeconds: 300 } }),
    });

    expect(response.status).toBe(200);
    expect(updateGitLabConnector).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({ name: 'Renamed', settings: { autoSyncIntervalSeconds: 300 } }),
      USER.id
    );
  });

  it('rejects invalid connector URLs before calling the service', async () => {
    const createGitLabConnector = vi.fn();
    registerServices(['integrations:gitlab:manage'], { createGitLabConnector });

    const response = await createApp().request('/api/integrations/gitlab/connectors', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Main', baseUrl: 'not a url', token: 'glpat-secret' }),
    });

    expect(response.status).toBe(400);
    expect(createGitLabConnector).not.toHaveBeenCalled();
  });

  it('rotates connector tokens without returning a raw token', async () => {
    const rotateGitLabConnectorToken = vi.fn().mockResolvedValue({
      id: 'connector-1',
      tokenMasked: '****cret',
      hasToken: true,
    });
    registerServices(['integrations:gitlab:manage'], { rotateGitLabConnectorToken });

    const response = await createApp().request('/api/integrations/gitlab/connectors/connector-1/token', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ token: 'glpat-secret' }),
    });

    expect(response.status).toBe(200);
    expect(rotateGitLabConnectorToken).toHaveBeenCalledWith('connector-1', 'glpat-secret', USER.id);
    expect(await response.json()).toEqual({
      data: { id: 'connector-1', tokenMasked: '****cret', hasToken: true },
    });
  });

  it('tests syncs deletes and searches allowlist through manage scope', async () => {
    const deleteGitLabConnector = vi.fn().mockResolvedValue(undefined);
    const testGitLabConnector = vi.fn().mockResolvedValue({ id: 'connector-1', syncStatus: 'idle' });
    const syncGitLabConnector = vi.fn().mockResolvedValue({ status: 'success', projectCount: 1, registryCount: 1 });
    const searchGitLabAllowlist = vi
      .fn()
      .mockResolvedValue([{ entryType: 'project', remoteId: '1', fullPath: 'group/project', name: 'project' }]);
    const listGitLabAllowlistOptions = vi
      .fn()
      .mockResolvedValue([{ entryType: 'project', remoteId: '2', fullPath: 'group/other', name: 'other' }]);
    const refreshGitLabAllowlistOptions = vi
      .fn()
      .mockResolvedValue([{ entryType: 'project', remoteId: '3', fullPath: 'group/new', name: 'new' }]);
    registerServices(['integrations:gitlab:manage'], {
      deleteGitLabConnector,
      testGitLabConnector,
      syncGitLabConnector,
      searchGitLabAllowlist,
      listGitLabAllowlistOptions,
      refreshGitLabAllowlistOptions,
    });

    const app = createApp();
    const testResponse = await app.request('/api/integrations/gitlab/connectors/connector-1/test', {
      method: 'POST',
      headers: authHeaders(),
    });
    const syncResponse = await app.request('/api/integrations/gitlab/connectors/connector-1/sync', {
      method: 'POST',
      headers: authHeaders(),
    });
    const searchResponse = await app.request(
      '/api/integrations/gitlab/connectors/connector-1/allowlist/search?q=group',
      {
        headers: authHeaders(),
      }
    );
    const optionsResponse = await app.request('/api/integrations/gitlab/connectors/connector-1/allowlist/options', {
      headers: authHeaders(),
    });
    const refreshOptionsResponse = await app.request(
      '/api/integrations/gitlab/connectors/connector-1/allowlist/options/refresh',
      {
        method: 'POST',
        headers: authHeaders(),
      }
    );
    const deleteResponse = await app.request('/api/integrations/gitlab/connectors/connector-1', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    expect(testResponse.status).toBe(200);
    expect(syncResponse.status).toBe(200);
    expect(searchResponse.status).toBe(200);
    expect(optionsResponse.status).toBe(200);
    expect(refreshOptionsResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(testGitLabConnector).toHaveBeenCalledWith('connector-1', USER.id);
    expect(syncGitLabConnector).toHaveBeenCalledWith('connector-1', USER.id);
    expect(searchGitLabAllowlist).toHaveBeenCalledWith('connector-1', 'group');
    expect(listGitLabAllowlistOptions).toHaveBeenCalledWith('connector-1');
    expect(refreshGitLabAllowlistOptions).toHaveBeenCalledWith('connector-1', USER.id);
    expect(deleteGitLabConnector).toHaveBeenCalledWith('connector-1', USER.id);
  });

  it('previews allowlist search before saving a connector through manage scope', async () => {
    const searchGitLabAllowlistPreview = vi
      .fn()
      .mockResolvedValue([{ entryType: 'project', remoteId: '1', fullPath: 'group/project', name: 'project' }]);
    registerServices(['integrations:gitlab:manage'], { searchGitLabAllowlistPreview });

    const response = await createApp().request('/api/integrations/gitlab/allowlist/preview-search', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseUrl: 'https://gitlab.example.com', token: 'glpat-secret', q: 'group' }),
    });

    expect(response.status).toBe(200);
    expect(searchGitLabAllowlistPreview).toHaveBeenCalledWith({
      baseUrl: 'https://gitlab.example.com',
      token: 'glpat-secret',
      q: 'group',
    });
    expect(await response.json()).toEqual({
      data: [{ entryType: 'project', remoteId: '1', fullPath: 'group/project', name: 'project' }],
    });
  });

  it('previews connection tests before saving a connector through manage scope', async () => {
    const testGitLabConnectorPreview = vi.fn().mockResolvedValue({
      capabilities: { api: true, projects: true },
      allowlistEntries: [{ entryType: 'project', remoteId: '1', fullPath: 'group/project', name: 'project' }],
    });
    registerServices(['integrations:gitlab:manage'], { testGitLabConnectorPreview });

    const response = await createApp().request('/api/integrations/gitlab/connectors/preview-test', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }),
    });

    expect(response.status).toBe(200);
    expect(testGitLabConnectorPreview).toHaveBeenCalledWith({
      baseUrl: 'https://gitlab.example.com',
      token: 'glpat-secret',
    });
    expect(await response.json()).toEqual({
      data: {
        capabilities: { api: true, projects: true },
        allowlistEntries: [{ entryType: 'project', remoteId: '1', fullPath: 'group/project', name: 'project' }],
      },
    });
  });

  it('creates previews tests syncs rotates and deletes Cloudflare connectors through manage scope', async () => {
    const createCloudflareConnector = vi.fn().mockResolvedValue({ id: 'cf-1', tokenMasked: '****cret' });
    const testCloudflareConnectorPreview = vi.fn().mockResolvedValue({
      capabilities: { apiReachable: true, tokenActive: true, zonesRead: true, dnsRead: true, dnsEdit: true },
      zones: [{ remoteId: 'zone-1', name: 'example.com' }],
    });
    const testCloudflareConnector = vi.fn().mockResolvedValue({ id: 'cf-1', syncStatus: 'idle' });
    const syncCloudflareConnector = vi.fn().mockResolvedValue({ status: 'success', zoneCount: 1 });
    const rotateCloudflareConnectorToken = vi.fn().mockResolvedValue({ id: 'cf-1', tokenMasked: '****cret' });
    const deleteCloudflareConnector = vi.fn().mockResolvedValue(undefined);
    registerServices(['integrations:cloudflare:manage'], {
      createCloudflareConnector,
      testCloudflareConnectorPreview,
      testCloudflareConnector,
      syncCloudflareConnector,
      rotateCloudflareConnectorToken,
      deleteCloudflareConnector,
    });

    const app = createApp();
    const createResponse = await app.request('/api/integrations/cloudflare/connectors', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Cloudflare', token: 'cf-secret' }),
    });
    const previewResponse = await app.request('/api/integrations/cloudflare/connectors/preview-test', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ token: 'cf-secret' }),
    });
    const testResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1/test', {
      method: 'POST',
      headers: authHeaders(),
    });
    const syncResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1/sync', {
      method: 'POST',
      headers: authHeaders(),
    });
    const rotateResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1/token', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ token: 'cf-secret-2' }),
    });
    const deleteResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1', {
      method: 'DELETE',
      headers: authHeaders(),
    });

    expect(createResponse.status).toBe(201);
    expect(previewResponse.status).toBe(200);
    expect(testResponse.status).toBe(200);
    expect(syncResponse.status).toBe(200);
    expect(rotateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(createCloudflareConnector).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cloudflare' }), USER.id);
    expect(testCloudflareConnectorPreview).toHaveBeenCalledWith({ token: 'cf-secret' });
    expect(testCloudflareConnector).toHaveBeenCalledWith('cf-1', USER.id);
    expect(syncCloudflareConnector).toHaveBeenCalledWith('cf-1', USER.id);
    expect(rotateCloudflareConnectorToken).toHaveBeenCalledWith('cf-1', 'cf-secret-2', USER.id);
    expect(deleteCloudflareConnector).toHaveBeenCalledWith('cf-1', USER.id);
  });

  it('allows Cloudflare DNS viewers to list connectors and zones without manage scope', async () => {
    const listCloudflareConnectors = vi.fn().mockResolvedValue([{ id: 'cf-1', tokenMasked: '****cret' }]);
    const getCloudflareConnector = vi.fn().mockResolvedValue({ id: 'cf-1', tokenMasked: '****cret' });
    const listCloudflareZones = vi.fn().mockResolvedValue([{ remoteId: 'zone-1', name: 'example.com' }]);
    const createCloudflareConnector = vi.fn();
    registerServices(['integrations:cloudflare:dns:view'], {
      listCloudflareConnectors,
      getCloudflareConnector,
      listCloudflareZones,
      createCloudflareConnector,
    });

    const app = createApp();
    const listResponse = await app.request('/api/integrations/cloudflare/connectors', { headers: authHeaders() });
    const getResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1', { headers: authHeaders() });
    const zonesResponse = await app.request('/api/integrations/cloudflare/connectors/cf-1/zones', {
      headers: authHeaders(),
    });
    const createResponse = await app.request('/api/integrations/cloudflare/connectors', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Cloudflare', token: 'cf-secret' }),
    });

    expect(listResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(zonesResponse.status).toBe(200);
    expect(createResponse.status).toBe(403);
    expect(listCloudflareConnectors).toHaveBeenCalled();
    expect(getCloudflareConnector).toHaveBeenCalledWith('cf-1');
    expect(listCloudflareZones).toHaveBeenCalledWith('cf-1');
    expect(createCloudflareConnector).not.toHaveBeenCalled();
  });
});
