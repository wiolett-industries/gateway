import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv, SessionData, User } from '@/types.js';
import { aiRoutes } from './ai.routes.js';
import { AISettingsService } from './ai.settings.service.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['feat:ai:use'],
  isBlocked: false,
};

const SESSION: SessionData = {
  userId: USER.id,
  user: USER,
  accessToken: 'oidc-access-token',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

function createDb(): DrizzleClient {
  return {
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
        findMany: vi.fn().mockResolvedValue([
          {
            id: USER.groupId,
            parentId: null,
            name: USER.groupName,
            scopes: USER.scopes,
          },
        ]),
      },
    },
  } as unknown as DrizzleClient;
}

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    throw error;
  });
  app.route('/api/ai', aiRoutes);
  return app;
}

function registerServices() {
  container.registerInstance(SessionService, {
    getSession: vi.fn().mockResolvedValue(SESSION),
    updateSession: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(false),
  } as unknown as SessionService);
  container.registerInstance(TOKENS.DrizzleClient, createDb());
  container.registerInstance(AISettingsService, {
    isEnabled: vi.fn().mockResolvedValue(true),
  } as unknown as AISettingsService);
}

afterEach(() => {
  container.reset();
});

describe('AI routes session-only authentication', () => {
  it('allows browser session users to query AI status', async () => {
    registerServices();

    const response = await createApp().request('/api/ai/status', {
      headers: { Cookie: 'session_id=session-1' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
  });

  it('rejects API tokens for AI routes', async () => {
    registerServices();
    container.registerInstance(TokensService, {
      validateToken: vi.fn().mockResolvedValue({ user: USER, scopes: USER.scopes }),
    } as unknown as TokensService);

    const response = await createApp().request('/api/ai/status', {
      headers: { Authorization: 'Bearer gw_test_token' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: 'This endpoint requires browser session authentication.',
    });
  });
});
