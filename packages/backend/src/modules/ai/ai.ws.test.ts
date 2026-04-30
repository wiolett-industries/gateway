import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';
import { AISettingsService } from './ai.settings.service.js';
import { authenticateWSConnection, createWSHandlers } from './ai.ws.js';

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

function createWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

function registerAiWsDependencies(user: User) {
  container.registerInstance(SessionService, {
    getSession: vi.fn().mockResolvedValue({ user }),
  } as unknown as SessionService);
  container.registerInstance(AuthService, {
    getUserById: vi.fn().mockResolvedValue(user),
  } as unknown as AuthService);
  container.registerInstance(AISettingsService, {
    isEnabled: vi.fn().mockResolvedValue(true),
  } as unknown as AISettingsService);
}

afterEach(() => {
  container.reset();
});

describe('AI websocket authentication', () => {
  it('rejects blocked session users', async () => {
    registerAiWsDependencies({ ...USER, isBlocked: true });
    const ws = createWs();
    const handlers = createWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    const authenticated = await authenticateWSConnection(ws as any, 'session-1');
    handlers.onClose(new Event('close'), ws as any);

    expect(authenticated).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth_error', message: 'Account is blocked' }));
  });
});
