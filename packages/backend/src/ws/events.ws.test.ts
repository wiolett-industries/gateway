import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/types.js';

const mocks = vi.hoisted(() => ({
  resolveLiveSessionUser: vi.fn(),
  resolveLiveUser: vi.fn(),
}));

vi.mock('@/modules/auth/live-session-user.js', () => ({
  resolveLiveSessionUser: mocks.resolveLiveSessionUser,
  resolveLiveUser: mocks.resolveLiveUser,
}));

import { authenticateEventsConnection, createEventsWSHandlers } from './events.ws.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['nodes:list'],
  isBlocked: false,
};

function createWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('events websocket authentication', () => {
  it('rejects blocked session users', async () => {
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, isBlocked: true },
      effectiveScopes: USER.scopes,
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onClose(new Event('close'), ws as any);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'error', message: 'unauthenticated' }));
    expect(ws.close).toHaveBeenCalledWith(4001, 'unauthenticated');
  });
});
