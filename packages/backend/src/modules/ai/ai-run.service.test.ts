import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { AIRunService } from './ai-run.service.js';

function createTransitionDb<T>(updateRows: T[], selectRows: unknown[][] = [[{ id: 'conversation-1' }]]) {
  const selectQueue = [...selectRows];
  const returning = vi.fn().mockResolvedValue(updateRows);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const orderBy = vi.fn(async () => selectQueue.shift() ?? []);
  const selectWhere = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { update, select },
    returning,
    updateWhere,
    set,
    update,
    limit,
    selectWhere,
    from,
    select,
  };
}

function createStartRunDb({ selectRows, insertRows = [] }: { selectRows: unknown[][]; insertRows?: unknown[][] }) {
  const selectQueue = [...selectRows];
  const insertQueue = [...insertRows];

  const selectLimit = vi.fn(async () => selectQueue.shift() ?? []);
  const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
  const selectWhere = vi.fn(() => ({ limit: selectLimit, orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn(async () => insertQueue.shift() ?? []);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const tx = { select, insert, update };
  const transaction = vi.fn((callback: (txArg: typeof tx) => unknown) => callback(tx));
  return {
    db: { select, insert, update, transaction },
    tx,
    select,
    insert,
    insertValues,
    update,
    updateSet,
    transaction,
  };
}

describe('AIRunService startUserRun', () => {
  it('creates a conversation, user message, and queued run atomically', async () => {
    const conversation = { id: 'conversation-1', lastContext: null };
    const message = { id: 'message-1' };
    const run = {
      id: 'run-1',
      conversationId: 'conversation-1',
      activeMessageId: 'message-1',
      clientCommandId: 'cmd-1',
      status: 'queued',
    };
    const harness = createStartRunDb({
      selectRows: [[], [], []],
      insertRows: [[conversation], [message], [run]],
    });
    const service = new AIRunService(harness.db as never);

    await expect(
      service.startUserRun({
        userId: 'user-1',
        title: '  New chat  ',
        userMessage: { role: 'user', content: 'hello' },
        clientCommandId: 'cmd-1',
        lastContext: { route: '/nodes' },
      })
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      userMessageId: 'message-1',
      run,
      duplicate: false,
    });

    expect(harness.transaction).toHaveBeenCalled();
    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: 'New chat',
        lastContext: { route: '/nodes' },
      })
    );
    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        sequence: 0,
        role: 'user',
        content: 'hello',
      })
    );
    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        userId: 'user-1',
        clientCommandId: 'cmd-1',
        activeMessageId: 'message-1',
        status: 'queued',
      })
    );
  });

  it('appends a new user turn after the existing conversation history', async () => {
    const conversation = { id: 'conversation-1', lastContext: null };
    const message = { id: 'message-2' };
    const run = {
      id: 'run-2',
      conversationId: 'conversation-1',
      activeMessageId: 'message-2',
      clientCommandId: 'cmd-2',
      status: 'queued',
    };
    const harness = createStartRunDb({
      selectRows: [[], [conversation], [], [], [{ sequence: 4 }]],
      insertRows: [[message], [run]],
    });
    const service = new AIRunService(harness.db as never);

    await expect(
      service.startUserRun({
        conversationId: 'conversation-1',
        userId: 'user-1',
        title: 'Existing chat',
        userMessage: { role: 'user', content: 'follow up' },
        clientCommandId: 'cmd-2',
      })
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      userMessageId: 'message-2',
      run,
      duplicate: false,
    });

    expect(harness.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        sequence: 5,
        role: 'user',
        content: 'follow up',
      })
    );
  });

  it('returns an existing run for a repeated command without creating another transaction', async () => {
    const run = {
      id: 'run-1',
      conversationId: 'conversation-1',
      activeMessageId: 'message-1',
      clientCommandId: 'cmd-1',
      status: 'queued',
    };
    const harness = createStartRunDb({ selectRows: [[run]] });
    const service = new AIRunService(harness.db as never);

    await expect(
      service.startUserRun({
        conversationId: 'conversation-1',
        userId: 'user-1',
        title: 'Existing chat',
        userMessage: { role: 'user', content: 'hello' },
        clientCommandId: 'cmd-1',
      })
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      userMessageId: 'message-1',
      run,
      duplicate: true,
    });

    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated new-conversation command before the conversation id is known', async () => {
    const run = {
      id: 'run-1',
      conversationId: 'conversation-1',
      activeMessageId: 'message-1',
      clientCommandId: 'cmd-1',
      status: 'queued',
    };
    const harness = createStartRunDb({ selectRows: [[run]] });
    const service = new AIRunService(harness.db as never);

    await expect(
      service.startUserRun({
        userId: 'user-1',
        title: 'New chat',
        userMessage: { role: 'user', content: 'hello' },
        clientCommandId: 'cmd-1',
      })
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      userMessageId: 'message-1',
      run,
      duplicate: true,
    });

    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('rejects a new message when the conversation already has an active run', async () => {
    const conversation = { id: 'conversation-1', lastContext: null };
    const activeRun = { id: 'run-active', status: 'running' };
    const harness = createStartRunDb({
      selectRows: [[], [conversation], [], [activeRun]],
    });
    const service = new AIRunService(harness.db as never);

    await expect(
      service.startUserRun({
        conversationId: 'conversation-1',
        userId: 'user-1',
        title: 'Existing chat',
        userMessage: { role: 'user', content: 'hello' },
        clientCommandId: 'cmd-2',
      })
    ).rejects.toMatchObject({
      code: 'AI_RUN_ACTIVE',
      statusCode: 409,
    });

    expect(harness.insert).not.toHaveBeenCalled();
  });
});

describe('AIRunService tool approval decisions', () => {
  it('atomically approves a pending tool call', async () => {
    const approved = {
      id: 'tool-1',
      status: 'approved',
      decision: 'approved',
      decisionClientCommandId: 'cmd-1',
    };
    const harness = createTransitionDb([approved]);
    const service = new AIRunService(harness.db as never);

    await expect(
      service.decideToolCall({
        conversationId: 'conversation-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        userId: 'user-1',
        clientCommandId: 'cmd-1',
        decision: 'approved',
      })
    ).resolves.toEqual({ toolCall: approved, duplicate: false });

    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        decision: 'approved',
        decisionUserId: 'user-1',
        decisionClientCommandId: 'cmd-1',
        decisionAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
    );
    expect(harness.select).toHaveBeenCalled();
  });

  it('treats a repeated identical tool decision as idempotent', async () => {
    const existing = {
      id: 'tool-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      status: 'approved',
      decision: 'approved',
      decisionClientCommandId: 'cmd-1',
    };
    const harness = createTransitionDb([], [[{ id: 'conversation-1' }], [existing], []]);
    const service = new AIRunService(harness.db as never);

    await expect(
      service.decideToolCall({
        conversationId: 'conversation-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        userId: 'user-1',
        clientCommandId: 'cmd-1',
        decision: 'approved',
      })
    ).resolves.toEqual({ toolCall: existing, duplicate: true });
  });

  it('rejects conflicting tool decisions', async () => {
    const harness = createTransitionDb(
      [],
      [
        [{ id: 'conversation-1' }],
        [
          {
            id: 'tool-1',
            runId: 'run-1',
            conversationId: 'conversation-1',
            status: 'approved',
            decision: 'approved',
            decisionClientCommandId: 'cmd-1',
          },
        ],
      ]
    );
    const service = new AIRunService(harness.db as never);

    const decision = service.decideToolCall({
      conversationId: 'conversation-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      userId: 'user-1',
      clientCommandId: 'cmd-2',
      decision: 'rejected',
    });

    await expect(decision).rejects.toBeInstanceOf(AppError);
    await expect(decision).rejects.toMatchObject({
      code: 'AI_TOOL_CALL_DECISION_CONFLICT',
      statusCode: 409,
    });
  });
});

describe('AIRunService question answers', () => {
  it('atomically answers a pending question', async () => {
    const answered = {
      id: 'question-1',
      status: 'answered',
      answer: 'Use production',
      answerClientCommandId: 'cmd-1',
    };
    const harness = createTransitionDb([answered]);
    const service = new AIRunService(harness.db as never);

    await expect(
      service.answerQuestion({
        conversationId: 'conversation-1',
        runId: 'run-1',
        questionId: 'question-1',
        userId: 'user-1',
        clientCommandId: 'cmd-1',
        answer: 'Use production',
      })
    ).resolves.toEqual({ question: answered, duplicate: false, remainingPendingQuestions: [] });

    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'answered',
        answer: 'Use production',
        answerUserId: 'user-1',
        answerClientCommandId: 'cmd-1',
        answeredAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
    );
    expect(harness.select).toHaveBeenCalled();
  });

  it('treats a repeated identical answer as idempotent', async () => {
    const existing = {
      id: 'question-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      status: 'answered',
      answer: 'Use production',
      answerClientCommandId: 'cmd-1',
    };
    const harness = createTransitionDb([], [[{ id: 'conversation-1' }], [existing]]);
    const service = new AIRunService(harness.db as never);

    await expect(
      service.answerQuestion({
        conversationId: 'conversation-1',
        runId: 'run-1',
        questionId: 'question-1',
        userId: 'user-1',
        clientCommandId: 'cmd-1',
        answer: 'Use production',
      })
    ).resolves.toEqual({ question: existing, duplicate: true, remainingPendingQuestions: [] });
  });

  it('rejects conflicting answers', async () => {
    const harness = createTransitionDb(
      [],
      [
        [{ id: 'conversation-1' }],
        [
          {
            id: 'question-1',
            runId: 'run-1',
            conversationId: 'conversation-1',
            status: 'answered',
            answer: 'Use production',
            answerClientCommandId: 'cmd-1',
          },
        ],
      ]
    );
    const service = new AIRunService(harness.db as never);

    const answer = service.answerQuestion({
      conversationId: 'conversation-1',
      runId: 'run-1',
      questionId: 'question-1',
      userId: 'user-1',
      clientCommandId: 'cmd-2',
      answer: 'Use staging',
    });

    await expect(answer).rejects.toBeInstanceOf(AppError);
    await expect(answer).rejects.toMatchObject({
      code: 'AI_QUESTION_ANSWER_CONFLICT',
      statusCode: 409,
    });
  });
});
