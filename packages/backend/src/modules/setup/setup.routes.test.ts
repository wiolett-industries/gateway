import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '@/middleware/error-handler.js';
import type { AppEnv } from '@/types.js';

const mocks = vi.hoisted(() => ({
  env: {
    SETUP_TOKEN: 'setup-secret',
    ACME_STAGING: false,
  },
  policy: {
    isSetupApiEnabled: vi.fn(),
  },
  setupService: {
    bootstrapManagementSSL: vi.fn(),
    bootstrapManagementSSLUpload: vi.fn(),
  },
  nodesService: {
    create: vi.fn(),
  },
}));

vi.mock('@/config/env.js', () => ({
  getEnv: () => mocks.env,
}));

vi.mock('@/container.js', () => ({
  container: {
    resolve: vi.fn((token: unknown) => {
      const name = typeof token === 'function' ? token.name : String(token);
      if (name === 'SetupTokenPolicyService') return mocks.policy;
      if (name === 'SetupService') return mocks.setupService;
      if (name === 'NodesService') return mocks.nodesService;
      throw new Error(`Unexpected resolve: ${name}`);
    }),
  },
}));

vi.mock('./setup.service.js', () => ({
  SetupService: class SetupService {},
}));

vi.mock('./setup-token-policy.js', () => ({
  SetupTokenPolicyService: class SetupTokenPolicyService {},
}));

vi.mock('@/modules/nodes/nodes.service.js', () => ({
  NodesService: class NodesService {},
}));

import { setupRoutes } from './setup.routes.js';

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route('/api/setup', setupRoutes);
  return app;
}

function authHeaders(token = 'setup-secret') {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('setup routes bootstrap-only policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.SETUP_TOKEN = 'setup-secret';
    mocks.env.ACME_STAGING = false;
    mocks.policy.isSetupApiEnabled.mockResolvedValue(true);
    mocks.setupService.bootstrapManagementSSL.mockResolvedValue({ status: 'configured' });
    mocks.setupService.bootstrapManagementSSLUpload.mockResolvedValue({ status: 'configured' });
    mocks.nodesService.create.mockResolvedValue({
      node: { id: 'node-1', type: 'nginx', hostname: 'node.local', status: 'pending' },
      enrollmentToken: 'gw_node_token',
      gatewayCertSha256: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
  });

  it('returns 404 after Gateway is configured before validating token', async () => {
    mocks.policy.isSetupApiEnabled.mockResolvedValue(false);

    const response = await createApp().request('/api/setup/enroll-node', {
      method: 'POST',
      headers: authHeaders('wrong-token'),
      body: JSON.stringify({ type: 'nginx', hostname: 'node.local' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.nodesService.create).not.toHaveBeenCalled();
  });

  it('returns 404 after Gateway is configured before request validation', async () => {
    mocks.policy.isSetupApiEnabled.mockResolvedValue(false);

    const response = await createApp().request('/api/setup/management-ssl-upload', {
      method: 'POST',
      headers: authHeaders('wrong-token'),
      body: JSON.stringify({ malformed: true }),
    });

    expect(response.status).toBe(404);
    expect(mocks.setupService.bootstrapManagementSSLUpload).not.toHaveBeenCalled();
  });

  it('returns 404 for management SSL setup after Gateway is configured', async () => {
    mocks.policy.isSetupApiEnabled.mockResolvedValue(false);

    const response = await createApp().request('/api/setup/management-ssl', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ domain: 'gateway.example.com' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.setupService.bootstrapManagementSSL).not.toHaveBeenCalled();
  });

  it('returns 404 for uploaded management SSL setup after Gateway is configured', async () => {
    mocks.policy.isSetupApiEnabled.mockResolvedValue(false);

    const response = await createApp().request('/api/setup/management-ssl-upload', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        domain: 'gateway.example.com',
        certificatePem: '-----BEGIN CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----',
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.setupService.bootstrapManagementSSLUpload).not.toHaveBeenCalled();
  });

  it('accepts a valid setup token before Gateway is configured', async () => {
    const response = await createApp().request('/api/setup/enroll-node', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'nginx', hostname: 'node.local' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.nodesService.create).toHaveBeenCalledWith(
      { type: 'nginx', hostname: 'node.local' },
      '00000000-0000-0000-0000-000000000000'
    );
  });

  it('rejects invalid setup token before Gateway is configured', async () => {
    const response = await createApp().request('/api/setup/enroll-node', {
      method: 'POST',
      headers: authHeaders('wrong-token'),
      body: JSON.stringify({ type: 'nginx', hostname: 'node.local' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.nodesService.create).not.toHaveBeenCalled();
  });

  it('rejects missing SETUP_TOKEN before Gateway is configured', async () => {
    mocks.env.SETUP_TOKEN = undefined as any;

    const response = await createApp().request('/api/setup/enroll-node', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'nginx', hostname: 'node.local' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.nodesService.create).not.toHaveBeenCalled();
  });
});
