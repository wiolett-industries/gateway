import 'reflect-metadata';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { AuthSettingsService } from '@/modules/auth/auth.settings.service.js';
import { GroupService } from '@/modules/groups/group.service.js';
import { McpSettingsService } from '@/modules/mcp/mcp-settings.service.js';
import { NetworkSettingsService } from '@/modules/settings/network-settings.service.js';
import { OutboundWebhookPolicyService } from '@/modules/settings/outbound-webhook-policy.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv, SessionData, User } from '@/types.js';
import { adminRoutes } from './admin.routes.js';

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

const SESSION: SessionData = {
  userId: USER.id,
  user: USER,
  accessToken: 'oidc-access-token',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  csrfToken: 'csrf-token',
};

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route('/api/admin', adminRoutes);
  return app;
}

function registerSession(scopes: string[]) {
  container.registerInstance(SessionService, {
    getSession: vi.fn().mockResolvedValue(SESSION),
    validateCsrfToken: vi.fn().mockResolvedValue(true),
    updateSession: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(false),
  } as unknown as SessionService);
  container.registerInstance(TOKENS.DrizzleClient, {
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue({
          id: USER.id,
          oidcSubject: USER.oidcSubject,
          email: USER.email,
          name: USER.name,
          avatarUrl: USER.avatarUrl,
          groupId: USER.groupId,
          isBlocked: USER.isBlocked,
        }),
      },
      permissionGroups: {
        findMany: vi.fn().mockResolvedValue([{ id: USER.groupId, parentId: null, name: USER.groupName, scopes }]),
      },
    },
  } as unknown as DrizzleClient);
}

function sessionHeaders() {
  return {
    Cookie: 'session_id=session-1',
    'X-CSRF-Token': 'csrf-token',
    'Content-Type': 'application/json',
  };
}

afterEach(() => {
  container.reset();
});

describe('admin Gateway settings route permissions', () => {
  it('allows reading Gateway settings with settings:gateway:view without admin:users', async () => {
    registerSession(['settings:gateway:view']);
    container.registerInstance(AuthSettingsService, {
      getConfig: vi.fn().mockResolvedValue({ oidcAutoCreateUsers: false, oidcDefaultGroupId: null }),
    } as unknown as AuthSettingsService);
    container.registerInstance(McpSettingsService, {
      getConfig: vi.fn().mockResolvedValue({ serverEnabled: true }),
    } as unknown as McpSettingsService);
    container.registerInstance(NetworkSettingsService, {
      getConfig: vi.fn().mockResolvedValue({
        clientIpSource: 'auto',
        trustedProxyCidrs: [],
        trustCloudflareHeaders: false,
      }),
    } as unknown as NetworkSettingsService);
    container.registerInstance(OutboundWebhookPolicyService, {
      getConfig: vi.fn().mockResolvedValue({
        allowPrivateNetworks: true,
        allowedPrivateCidrs: ['10.0.0.0/8', '172.16.0.0/12'],
      }),
    } as unknown as OutboundWebhookPolicyService);
    container.registerInstance(GroupService, {
      listGroups: vi.fn().mockResolvedValue([]),
    } as unknown as GroupService);

    const response = await createApp().request('/api/admin/auth-settings', { headers: sessionHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      oidcAutoCreateUsers: false,
      oidcDefaultGroupId: null,
      mcpServerEnabled: true,
      networkSecurity: {
        clientIpSource: 'auto',
        trustedProxyCidrs: [],
        trustCloudflareHeaders: false,
      },
      outboundWebhookPolicy: {
        allowPrivateNetworks: true,
        allowedPrivateCidrs: ['10.0.0.0/8', '172.16.0.0/12'],
      },
      currentRequestIp: {
        source: 'unknown',
      },
      availableGroups: [],
    });
  });

  it('does not allow editing Gateway settings with only settings:gateway:view', async () => {
    registerSession(['settings:gateway:view']);

    const response = await createApp().request('/api/admin/auth-settings', {
      method: 'PUT',
      headers: sessionHeaders(),
      body: JSON.stringify({ mcpServerEnabled: false }),
    });

    expect(response.status).toBe(403);
  });
});
