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

function allowingRedis() {
  const pipeline = {
    zremrangebyscore: vi.fn(() => pipeline),
    zcard: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 0],
      [null, 1],
      [null, 1],
    ]),
  };
  return { pipeline: vi.fn(() => pipeline) };
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

  it('keeps queued destructive approvals on the backend without leaking queue fields to the client', async () => {
    registerAiWsDependencies(USER);
    container.registerInstance(TOKENS.RedisClient, allowingRedis() as any);

    const resumeAfterApproval = vi.fn(async function* () {
      yield { type: 'done', requestId: 'request-4' } as const;
    });
    const streamChat = vi.fn(async function* () {
      yield {
        type: 'tool_approval_required',
        requestId: 'request-4',
        id: 'tool-1',
        name: 'manage_docker_container_config',
        arguments: { containerId: 'container-1' },
        _pendingMessages: [{ role: 'assistant', content: null }],
        _queuedApprovals: [{ id: 'tool-2', name: 'start_docker_container', arguments: { containerId: 'container-1' } }],
      } as any;
    });
    container.registerInstance(AIService, { streamChat, resumeAfterApproval } as unknown as AIService);

    const ws = createWs();
    const handlers = createWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    const authenticated = await authenticateWSConnection(ws as any, 'session-1');
    expect(authenticated).toBe(true);

    await handlers.onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'chat',
          requestId: 'request-4',
          messages: [{ role: 'user', content: 'set env then start' }],
        }),
      }),
      ws as any
    );

    const approvalFrame = ws.send.mock.calls
      .map(([payload]) => JSON.parse(payload))
      .find((payload) => payload.type === 'tool_approval_required');
    expect(approvalFrame).toEqual({
      type: 'tool_approval_required',
      requestId: 'request-4',
      id: 'tool-1',
      name: 'manage_docker_container_config',
      arguments: { containerId: 'container-1' },
    });

    await handlers.onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'tool_approval',
          requestId: 'request-4',
          toolCallId: 'tool-1',
          approved: true,
        }),
      }),
      ws as any
    );
    handlers.onClose(new Event('close'), ws as any);

    expect(resumeAfterApproval).toHaveBeenCalledWith(
      USER,
      'tool-1',
      'manage_docker_container_config',
      { containerId: 'container-1' },
      true,
      [{ role: 'assistant', content: null }],
      undefined,
      expect.any(AbortSignal),
      'request-4',
      undefined,
      undefined,
      [{ id: 'tool-2', name: 'start_docker_container', arguments: { containerId: 'container-1' } }]
    );
  });
});
