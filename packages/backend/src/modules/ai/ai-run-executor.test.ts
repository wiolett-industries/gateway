import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import type { User } from '@/types.js';
import { AIService } from './ai.service.js';
import type { WSServerMessage } from './ai.types.js';
import { AIRunExecutor } from './ai-run-executor.js';

const USER: User = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['feat:ai:use'],
  isBlocked: false,
};

async function* streamEvents(events: WSServerMessage[]) {
  for (const event of events) yield event;
}

function createExecutorHarness(events: WSServerMessage[]) {
  const selectQueue = [
    [
      {
        id: 'run-1',
        conversationId: 'conversation-1',
        userId: USER.id,
        status: 'queued',
        activeMessageId: 'user-message-1',
        clientCommandId: 'cmd-1',
        assistantDraftContent: null,
        error: null,
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
        updatedAt: new Date('2026-06-26T10:00:00.000Z'),
      },
    ],
    [{ id: 'conversation-1', userId: USER.id, title: 'Runtime chat', lastContext: null }],
    [{ uiMessage: { role: 'user', content: 'hello' } }],
    [],
  ];
  const insertReturningQueue = [[{ id: 'assistant-message-1' }]];

  let orderByCalls = 0;
  const selectLimit = vi.fn(async () => selectQueue.shift() ?? []);
  const selectOrderBy = vi.fn(() => {
    orderByCalls += 1;
    return orderByCalls === 1 ? Promise.resolve(selectQueue.shift() ?? []) : { limit: selectLimit };
  });
  const selectWhere = vi.fn(() => ({ limit: selectLimit, orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn(async () => insertReturningQueue.shift() ?? []);
  const insertValues = vi.fn(() => ({
    returning: insertReturning,
    onConflictDoUpdate: vi.fn(async () => undefined),
  }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const publishConversationChanged = vi.fn();
  const publishAssistantDelta = vi.fn();
  const executor = new AIRunExecutor(
    { select, insert, update } as never,
    publishConversationChanged,
    publishAssistantDelta
  );

  container.registerInstance(AIService, {
    streamChat: vi.fn(() => streamEvents(events)),
  } as unknown as AIService);

  return {
    executor,
    insertValues,
    updateSet,
    publishConversationChanged,
    publishAssistantDelta,
  };
}

async function executeRun(executor: AIRunExecutor): Promise<void> {
  await (executor as unknown as { executeRun(user: User, runId: string): Promise<void> }).executeRun(USER, 'run-1');
}

afterEach(() => {
  container.reset();
});

describe('AIRunExecutor live assistant draft streaming', () => {
  it('emits lightweight deltas without per-delta DB draft writes or full snapshot publishes', async () => {
    const harness = createExecutorHarness([
      { type: 'text_delta', requestId: 'request-1', content: 'Hel' },
      { type: 'text_delta', requestId: 'request-1', content: 'lo' },
      { type: 'done', requestId: 'request-1' },
    ]);

    await executeRun(harness.executor);

    expect(harness.publishAssistantDelta).toHaveBeenCalledTimes(2);
    expect(harness.publishAssistantDelta).toHaveBeenNthCalledWith(1, USER.id, 'conversation-1', 'run-1', 'Hel', 1);
    expect(harness.publishAssistantDelta).toHaveBeenNthCalledWith(2, USER.id, 'conversation-1', 'run-1', 'lo', 2);
    expect(harness.publishConversationChanged).toHaveBeenCalledTimes(2);
    expect(harness.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ assistantDraftContent: 'Hel' }));
    expect(harness.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ assistantDraftContent: 'Hello' }));
  });

  it('flushes accumulated text to an assistant message on done', async () => {
    const harness = createExecutorHarness([
      { type: 'text_delta', requestId: 'request-1', content: 'Hello' },
      { type: 'done', requestId: 'request-1' },
    ]);

    await executeRun(harness.executor);

    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Hello',
        uiMessage: expect.objectContaining({ role: 'assistant', content: 'Hello' }),
      })
    );
  });

  it('flushes accumulated text before waiting for tool approval', async () => {
    const harness = createExecutorHarness([
      { type: 'text_delta', requestId: 'request-1', content: 'Need approval' },
      {
        type: 'tool_approval_required',
        requestId: 'request-1',
        id: 'call-1',
        name: 'pull_docker_image',
        arguments: { imageRef: 'redis:latest' },
      },
    ]);

    await executeRun(harness.executor);

    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Need approval',
      })
    );
    expect(harness.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting_for_approval' }));
  });

  it('flushes accumulated text before marking a run failed', async () => {
    const harness = createExecutorHarness([
      { type: 'text_delta', requestId: 'request-1', content: 'Partial answer' },
      { type: 'error', requestId: 'request-1', message: 'provider failed' },
    ]);

    await executeRun(harness.executor);

    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Partial answer',
      })
    );
    expect(harness.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'provider failed' })
    );
  });

  it('persists a hidden conversation-ended marker after end_conversation', async () => {
    const harness = createExecutorHarness([
      {
        type: 'tool_call_start',
        requestId: 'request-1',
        id: 'call-end',
        name: 'end_conversation',
        arguments: { reason: 'I can only help with Gateway infrastructure.' },
      },
      {
        type: 'tool_result',
        requestId: 'request-1',
        id: 'call-end',
        name: 'end_conversation',
        result: { ended: true, reason: 'I can only help with Gateway infrastructure.' },
      },
      {
        type: 'conversation_ended',
        requestId: 'request-1',
        reason: 'I can only help with Gateway infrastructure.',
      },
      { type: 'done', requestId: 'request-1' },
    ]);

    await executeRun(harness.executor);

    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'assistant',
        content: '',
        uiMessage: expect.objectContaining({
          role: 'assistant',
          content: '',
          conversationStatus: 'ended',
          blockReason: 'I can only help with Gateway infrastructure.',
        }),
      })
    );
    expect(harness.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('persists a redacted copy of one-time API token tool results', async () => {
    const harness = createExecutorHarness([
      {
        type: 'tool_call_start',
        requestId: 'request-1',
        id: 'call-1',
        name: 'manage_api_token',
        arguments: { operation: 'create', name: 'Deploy' },
      },
      {
        type: 'tool_result',
        requestId: 'request-1',
        id: 'call-1',
        name: 'manage_api_token',
        result: { id: 'token-1', name: 'Deploy', token: 'gw_secret' },
      },
      { type: 'done', requestId: 'request-1' },
    ]);

    await executeRun(harness.executor);

    expect(harness.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        result: { id: 'token-1', name: 'Deploy', token: '[REDACTED_ONE_TIME_SECRET]', tokenRedacted: true },
      })
    );
  });
});
