import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container, TOKENS } from '@/container.js';
import { RATE_LIMIT_REDIS_TIMEOUT_MS } from '@/lib/rate-limit-timeout.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';
import { AIService } from './ai.service.js';
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
    getConfig: vi.fn().mockResolvedValue({
      rateLimitMax: 10,
      rateLimitWindowSeconds: 60,
    }),
  } as unknown as AISettingsService);
}

function throwingRedis() {
  const pipeline = {
    zremrangebyscore: vi.fn(() => pipeline),
    zcard: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec: vi.fn().mockRejectedValue(new Error('redis down')),
  };
  return { pipeline };
}

function truncatedRedis() {
  const pipeline = {
    zremrangebyscore: vi.fn(() => pipeline),
    zcard: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 0],
    ]),
  };
  return { pipeline };
}

function hangingRedis() {
  const pipeline = {
    zremrangebyscore: vi.fn(() => pipeline),
    zcard: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec: vi.fn().mockReturnValue(new Promise<never>(() => {})),
  };
  return { pipeline };
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

  it('fails closed when the chat rate limiter cannot reach Redis', async () => {
    registerAiWsDependencies(USER);
    container.registerInstance(TOKENS.RedisClient, throwingRedis() as any);
    const streamChat = vi.fn();
    container.registerInstance(AIService, { streamChat } as unknown as AIService);
    const ws = createWs();
    const handlers = createWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    const authenticated = await authenticateWSConnection(ws as any, 'session-1');
    expect(authenticated).toBe(true);

    await handlers.onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'chat',
          requestId: 'request-1',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
      ws as any
    );
    handlers.onClose(new Event('close'), ws as any);

    expect(streamChat).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'error',
        requestId: 'request-1',
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Gateway is temporarily unavailable',
      })
    );
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'done', requestId: 'request-1' }));
  });

  it('fails closed when the chat rate limiter gets incomplete Redis results', async () => {
    registerAiWsDependencies(USER);
    container.registerInstance(TOKENS.RedisClient, truncatedRedis() as any);
    const streamChat = vi.fn();
    container.registerInstance(AIService, { streamChat } as unknown as AIService);
    const ws = createWs();
    const handlers = createWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    const authenticated = await authenticateWSConnection(ws as any, 'session-1');
    expect(authenticated).toBe(true);

    await handlers.onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'chat',
          requestId: 'request-2',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
      ws as any
    );
    handlers.onClose(new Event('close'), ws as any);

    expect(streamChat).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'error',
        requestId: 'request-2',
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Gateway is temporarily unavailable',
      })
    );
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'done', requestId: 'request-2' }));
  });

  it('fails closed when the chat rate limiter stalls', async () => {
    vi.useFakeTimers();
    try {
      registerAiWsDependencies(USER);
      container.registerInstance(TOKENS.RedisClient, hangingRedis() as any);
      const streamChat = vi.fn();
      container.registerInstance(AIService, { streamChat } as unknown as AIService);
      const ws = createWs();
      const handlers = createWSHandlers();

      handlers.onOpen(new Event('open'), ws as any);
      const authenticated = await authenticateWSConnection(ws as any, 'session-1');
      expect(authenticated).toBe(true);

      const messagePromise = handlers.onMessage(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'chat',
            requestId: 'request-3',
            messages: [{ role: 'user', content: 'hello' }],
          }),
        }),
        ws as any
      );
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_REDIS_TIMEOUT_MS);
      await messagePromise;
      handlers.onClose(new Event('close'), ws as any);

      expect(streamChat).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          requestId: 'request-3',
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Gateway is temporarily unavailable',
        })
      );
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'done', requestId: 'request-3' }));
    } finally {
      vi.useRealTimers();
    }
  });
});
