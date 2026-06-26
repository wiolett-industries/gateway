import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import {
  type AIRun,
  type AIRunQuestion,
  type AIRunStatus,
  type AIRunToolCall,
  type AIToolApprovalClass,
  type AIToolApprovalPolicy,
  type AIToolCallStatus,
  aiConversationMessages,
  aiConversations,
  aiRunQuestions,
  aiRuns,
  aiRunToolCalls,
} from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { User } from '@/types.js';
import { AIRunExecutor } from './ai-run-executor.js';

const ACTIVE_RUN_STATUSES: AIRunStatus[] = ['queued', 'running', 'waiting_for_approval', 'waiting_for_answer'];

export function aiConversationChangedChannel(userId: string, conversationId: string): string {
  return `ai.conversation.changed.${userId}.${conversationId}`;
}

export interface AIConversationChangedEvent {
  userId: string;
  conversationId: string;
  invalidatedStores?: string[];
}

export interface CreateAIRunInput {
  conversationId: string;
  userId: string;
  clientCommandId: string;
  activeMessageId?: string | null;
}

export interface StartUserRunInput {
  conversationId?: string | null;
  userId: string;
  title: string;
  userMessage: Record<string, unknown>;
  clientCommandId: string;
  lastContext?: Record<string, unknown> | null;
}

export interface StartUserRunResult {
  conversationId: string;
  userMessageId: string | null;
  run: AIRun;
  duplicate: boolean;
}

export interface RecordToolCallInput {
  runId: string;
  conversationId: string;
  assistantMessageId?: string | null;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  classification: AIToolApprovalClass;
  approvalPolicy: AIToolApprovalPolicy;
  requiredScopes?: string[];
  status?: AIToolCallStatus;
}

export interface RuntimeSnapshot {
  activeRun: AIRun | null;
  pendingApprovals: AIRunToolCall[];
  pendingQuestion: AIRunQuestion | null;
  pendingQuestions: AIRunQuestion[];
  toolCalls: AIRunToolCall[];
}

export interface AIConversationRuntimeSnapshot {
  conversation: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    lastContext: Record<string, unknown> | null;
    discoveredToolsets: string[];
    checkpoint: Record<string, unknown> | null;
  };
  messages: unknown[];
  runtime: RuntimeSnapshot;
}

export class AIRunService {
  private readonly executor: AIRunExecutor;

  constructor(
    private readonly db: DrizzleClient,
    private readonly eventBus?: EventBusService
  ) {
    this.executor = new AIRunExecutor(db, (userId, conversationId, invalidatedStores) =>
      this.publishConversationChanged(userId, conversationId, invalidatedStores)
    );
  }

  async startUserRun(input: StartUserRunInput): Promise<StartUserRunResult> {
    const title = normalizeConversationTitle(input.title);
    const existingByCommand = input.conversationId
      ? await this.findRunByCommand(input.userId, input.conversationId, input.clientCommandId)
      : await this.findRunByUserCommand(input.userId, input.clientCommandId);
    if (existingByCommand) {
      return {
        conversationId: existingByCommand.conversationId,
        userMessageId: existingByCommand.activeMessageId,
        run: existingByCommand,
        duplicate: true,
      };
    }

    const result = await this.db.transaction(async (tx) => {
      const conversation = input.conversationId
        ? await getOwnedConversation(tx, input.userId, input.conversationId)
        : await createConversation(tx, {
            userId: input.userId,
            title: await resolveUniqueTitle(tx, input.userId, title),
            lastContext: input.lastContext ?? null,
          });

      if (!conversation) {
        throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');
      }

      const existingInTransaction = await findRunByCommand(tx, input.userId, conversation.id, input.clientCommandId);
      if (existingInTransaction) {
        return {
          conversationId: existingInTransaction.conversationId,
          userMessageId: existingInTransaction.activeMessageId,
          run: existingInTransaction,
          duplicate: true,
        };
      }

      const activeRun = await getActiveRunForUpdate(tx, conversation.id);
      if (activeRun) {
        throw new AppError(409, 'AI_RUN_ACTIVE', 'Conversation already has an active AI run');
      }

      const now = new Date();
      const sequence = await nextMessageSequence(tx, conversation.id);
      const [message] = await tx
        .insert(aiConversationMessages)
        .values(toConversationMessage(conversation.id, input.userMessage, sequence))
        .returning({ id: aiConversationMessages.id });

      const [run] = await tx
        .insert(aiRuns)
        .values({
          conversationId: conversation.id,
          userId: input.userId,
          clientCommandId: input.clientCommandId,
          activeMessageId: message.id,
          status: 'queued',
          updatedAt: now,
        })
        .returning();

      await tx
        .update(aiConversations)
        .set({ lastContext: input.lastContext ?? conversation.lastContext, updatedAt: now })
        .where(eq(aiConversations.id, conversation.id));

      return {
        conversationId: conversation.id,
        userMessageId: message.id,
        run,
        duplicate: false,
      };
    });

    this.publishConversationChanged(input.userId, result.conversationId);
    return result;
  }

  async createRun(input: CreateAIRunInput): Promise<{ run: AIRun; duplicate: boolean }> {
    const existingByCommand = await this.findRunByCommand(input.userId, input.conversationId, input.clientCommandId);
    if (existingByCommand) return { run: existingByCommand, duplicate: true };

    const [run] = await this.db
      .insert(aiRuns)
      .values({
        conversationId: input.conversationId,
        userId: input.userId,
        clientCommandId: input.clientCommandId,
        activeMessageId: input.activeMessageId ?? null,
      })
      .returning();

    return { run, duplicate: false };
  }

  async getActiveRun(conversationId: string): Promise<AIRun | null> {
    const rows = await this.db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.conversationId, conversationId), inArray(aiRuns.status, ACTIVE_RUN_STATUSES)))
      .orderBy(desc(aiRuns.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateRunStatus(runId: string, status: AIRunStatus, error?: string | null): Promise<AIRun> {
    const now = new Date();
    const terminal =
      status === 'completed'
        ? { completedAt: now, stoppedAt: null }
        : status === 'stopped'
          ? { completedAt: null, stoppedAt: now }
          : { completedAt: null, stoppedAt: null };
    const [run] = await this.db
      .update(aiRuns)
      .set({
        status,
        error: error ?? null,
        updatedAt: now,
        startedAt: status === 'running' ? now : undefined,
        ...terminal,
      })
      .where(eq(aiRuns.id, runId))
      .returning();
    if (!run) throw new AppError(404, 'AI_RUN_NOT_FOUND', 'AI run not found');
    return run;
  }

  async recordToolCall(input: RecordToolCallInput): Promise<AIRunToolCall> {
    const [toolCall] = await this.db
      .insert(aiRunToolCalls)
      .values({
        runId: input.runId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId ?? null,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        toolArgs: input.toolArgs,
        classification: input.classification,
        approvalPolicy: input.approvalPolicy,
        requiredScopes: input.requiredScopes ?? [],
        status: input.status ?? 'created',
      })
      .onConflictDoUpdate({
        target: [aiRunToolCalls.runId, aiRunToolCalls.toolCallId],
        set: {
          assistantMessageId: input.assistantMessageId ?? null,
          toolName: input.toolName,
          toolArgs: input.toolArgs,
          classification: input.classification,
          approvalPolicy: input.approvalPolicy,
          requiredScopes: input.requiredScopes ?? [],
          updatedAt: new Date(),
        },
      })
      .returning();
    return toolCall;
  }

  async decideToolCall(input: {
    conversationId: string;
    runId: string;
    toolCallId: string;
    userId: string;
    clientCommandId: string;
    decision: 'approved' | 'rejected';
  }): Promise<{ toolCall: AIRunToolCall; duplicate: boolean }> {
    await assertOwnedConversation(this.db, input.userId, input.conversationId);
    const nextStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    const now = new Date();
    const [updated] = await this.db
      .update(aiRunToolCalls)
      .set({
        status: nextStatus,
        decision: input.decision,
        decisionUserId: input.userId,
        decisionClientCommandId: input.clientCommandId,
        decisionAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiRunToolCalls.id, input.toolCallId),
          eq(aiRunToolCalls.runId, input.runId),
          eq(aiRunToolCalls.conversationId, input.conversationId),
          eq(aiRunToolCalls.status, 'pending_approval')
        )
      )
      .returning();

    if (updated) {
      this.publishConversationChanged(input.userId, input.conversationId);
      return { toolCall: updated, duplicate: false };
    }

    const existing = await this.getToolCall(input.toolCallId);
    if (!existing) throw new AppError(404, 'AI_TOOL_CALL_NOT_FOUND', 'AI tool call not found');
    if (existing.runId !== input.runId || existing.conversationId !== input.conversationId) {
      throw new AppError(404, 'AI_TOOL_CALL_NOT_FOUND', 'AI tool call not found');
    }
    if (existing.decision === input.decision && (existing.status === 'approved' || existing.status === 'rejected')) {
      return { toolCall: existing, duplicate: true };
    }
    throw new AppError(409, 'AI_TOOL_CALL_DECISION_CONFLICT', 'Tool call is no longer pending approval');
  }

  async recordQuestion(input: {
    runId: string;
    conversationId: string;
    question: string;
    toolCallId?: string;
  }): Promise<AIRunQuestion> {
    const [question] = await this.db
      .insert(aiRunQuestions)
      .values({
        runId: input.runId,
        conversationId: input.conversationId,
        toolCallId: input.toolCallId ?? input.runId,
        question: input.question,
      })
      .returning();
    return question;
  }

  async answerQuestion(input: {
    conversationId: string;
    runId: string;
    questionId: string;
    userId: string;
    clientCommandId: string;
    answer: string;
  }): Promise<{ question: AIRunQuestion; duplicate: boolean; remainingPendingQuestions: AIRunQuestion[] }> {
    await assertOwnedConversation(this.db, input.userId, input.conversationId);
    const now = new Date();
    const [updated] = await this.db
      .update(aiRunQuestions)
      .set({
        status: 'answered',
        answer: input.answer,
        answerUserId: input.userId,
        answerClientCommandId: input.clientCommandId,
        answeredAt: now,
        updatedAt: now,
      })
      .where(
        and(
          or(eq(aiRunQuestions.id, input.questionId), eq(aiRunQuestions.toolCallId, input.questionId)),
          eq(aiRunQuestions.runId, input.runId),
          eq(aiRunQuestions.conversationId, input.conversationId),
          eq(aiRunQuestions.status, 'pending')
        )
      )
      .returning();

    if (updated) {
      this.publishConversationChanged(input.userId, input.conversationId);
      return {
        question: updated,
        duplicate: false,
        remainingPendingQuestions: await this.listPendingQuestions(input.runId),
      };
    }

    const existing = await this.getQuestion(input.questionId, input.runId, input.conversationId);
    if (!existing) throw new AppError(404, 'AI_QUESTION_NOT_FOUND', 'AI question not found');
    if (existing.runId !== input.runId || existing.conversationId !== input.conversationId) {
      throw new AppError(404, 'AI_QUESTION_NOT_FOUND', 'AI question not found');
    }
    if (existing.status === 'answered' && existing.answer === input.answer) {
      return {
        question: existing,
        duplicate: true,
        remainingPendingQuestions: await this.listPendingQuestions(input.runId),
      };
    }
    throw new AppError(409, 'AI_QUESTION_ANSWER_CONFLICT', 'Question is no longer pending');
  }

  startApprovalContinuation(
    user: User,
    input: {
      conversationId: string;
      runId: string;
      toolCall: AIRunToolCall;
      approved: boolean;
    }
  ): void {
    this.executor.startApprovalContinuation(user, input);
  }

  startQuestionContinuation(
    user: User,
    input: {
      conversationId: string;
      runId: string;
      question: AIRunQuestion;
    }
  ): void {
    this.executor.startQuestionContinuation(user, input);
  }

  async stopRun(input: {
    conversationId: string;
    runId: string;
    userId: string;
  }): Promise<{ run: AIRun; duplicate: boolean }> {
    await assertOwnedConversation(this.db, input.userId, input.conversationId);
    const now = new Date();

    const [stopped] = await this.db
      .update(aiRuns)
      .set({
        status: 'stopped',
        error: null,
        stoppedAt: now,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiRuns.id, input.runId),
          eq(aiRuns.conversationId, input.conversationId),
          eq(aiRuns.userId, input.userId),
          inArray(aiRuns.status, ACTIVE_RUN_STATUSES)
        )
      )
      .returning();

    if (stopped) {
      await Promise.all([
        this.db
          .update(aiRunToolCalls)
          .set({ status: 'stopped', updatedAt: now })
          .where(
            and(
              eq(aiRunToolCalls.runId, input.runId),
              eq(aiRunToolCalls.conversationId, input.conversationId),
              inArray(aiRunToolCalls.status, ['created', 'pending_approval', 'approved', 'running'])
            )
          ),
        this.db
          .update(aiRunQuestions)
          .set({ status: 'stopped', updatedAt: now })
          .where(
            and(
              eq(aiRunQuestions.runId, input.runId),
              eq(aiRunQuestions.conversationId, input.conversationId),
              eq(aiRunQuestions.status, 'pending')
            )
          ),
      ]);
      this.executor.abortRun(input.runId);
      this.publishConversationChanged(input.userId, input.conversationId);
      return { run: stopped, duplicate: false };
    }

    const rows = await this.db
      .select()
      .from(aiRuns)
      .where(
        and(
          eq(aiRuns.id, input.runId),
          eq(aiRuns.conversationId, input.conversationId),
          eq(aiRuns.userId, input.userId)
        )
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new AppError(404, 'AI_RUN_NOT_FOUND', 'AI run not found');
    if (existing.status === 'stopped') return { run: existing, duplicate: true };
    throw new AppError(409, 'AI_RUN_NOT_ACTIVE', 'AI run is no longer active');
  }

  startRunExecution(user: User, runId: string): void {
    this.executor.startRunExecution(user, runId);
  }

  async getRuntimeSnapshot(conversationId: string): Promise<RuntimeSnapshot> {
    const activeRun = await this.getActiveRun(conversationId);
    if (!activeRun) {
      return {
        activeRun: null,
        pendingApprovals: [],
        pendingQuestion: null,
        pendingQuestions: [],
        toolCalls: await this.listConversationToolCalls(conversationId),
      };
    }

    const [activeToolCalls, questions, toolCalls] = await Promise.all([
      this.db.select().from(aiRunToolCalls).where(eq(aiRunToolCalls.runId, activeRun.id)),
      this.db
        .select()
        .from(aiRunQuestions)
        .where(eq(aiRunQuestions.runId, activeRun.id))
        .orderBy(asc(aiRunQuestions.createdAt)),
      this.listConversationToolCalls(conversationId),
    ]);
    const pendingQuestions = questions.filter((question) => question.status === 'pending');

    return {
      activeRun,
      pendingApprovals: activeToolCalls.filter((toolCall) => toolCall.status === 'pending_approval'),
      pendingQuestion: pendingQuestions[0] ?? null,
      pendingQuestions,
      toolCalls,
    };
  }

  async getConversationSnapshot(userId: string, conversationId: string): Promise<AIConversationRuntimeSnapshot | null> {
    const conversation = await getOwnedConversation(this.db, userId, conversationId);
    if (!conversation) return null;

    const [messages, runtime] = await Promise.all([
      this.db
        .select({
          id: aiConversationMessages.id,
          sequence: aiConversationMessages.sequence,
          uiMessage: aiConversationMessages.uiMessage,
          createdAt: aiConversationMessages.createdAt,
        })
        .from(aiConversationMessages)
        .where(eq(aiConversationMessages.conversationId, conversationId))
        .orderBy(asc(aiConversationMessages.sequence)),
      this.getRuntimeSnapshot(conversationId),
    ]);

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastContext: conversation.lastContext,
        discoveredToolsets: conversation.discoveredToolsets,
        checkpoint: conversation.checkpoint,
      },
      messages: withAssistantDraftMessage(
        messages.map((message) =>
          toSnapshotMessage(message.id, message.sequence, message.uiMessage, message.createdAt)
        ),
        runtime.activeRun
      ),
      runtime,
    };
  }

  private async findRunByCommand(
    userId: string,
    conversationId: string,
    clientCommandId: string
  ): Promise<AIRun | null> {
    return findRunByCommand(this.db, userId, conversationId, clientCommandId);
  }

  private async findRunByUserCommand(userId: string, clientCommandId: string): Promise<AIRun | null> {
    return findRunByUserCommand(this.db, userId, clientCommandId);
  }

  private async getToolCall(toolCallId: string): Promise<AIRunToolCall | null> {
    const rows = await this.db.select().from(aiRunToolCalls).where(eq(aiRunToolCalls.id, toolCallId)).limit(1);
    return rows[0] ?? null;
  }

  private async getQuestion(questionId: string, runId: string, conversationId: string): Promise<AIRunQuestion | null> {
    const rows = await this.db
      .select()
      .from(aiRunQuestions)
      .where(
        and(
          or(eq(aiRunQuestions.id, questionId), eq(aiRunQuestions.toolCallId, questionId)),
          eq(aiRunQuestions.runId, runId),
          eq(aiRunQuestions.conversationId, conversationId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async listPendingQuestions(runId: string): Promise<AIRunQuestion[]> {
    return this.db
      .select()
      .from(aiRunQuestions)
      .where(and(eq(aiRunQuestions.runId, runId), eq(aiRunQuestions.status, 'pending')))
      .orderBy(asc(aiRunQuestions.createdAt));
  }

  private async listConversationToolCalls(conversationId: string): Promise<AIRunToolCall[]> {
    return this.db
      .select()
      .from(aiRunToolCalls)
      .where(eq(aiRunToolCalls.conversationId, conversationId))
      .orderBy(asc(aiRunToolCalls.createdAt));
  }

  private publishConversationChanged(userId: string, conversationId: string, invalidatedStores?: string[]): void {
    this.eventBus?.publish(aiConversationChangedChannel(userId, conversationId), {
      userId,
      conversationId,
      ...(invalidatedStores?.length ? { invalidatedStores } : {}),
    } satisfies AIConversationChangedEvent);
  }
}

type DbLike = Pick<DrizzleClient, 'select' | 'insert' | 'update'>;

function normalizeConversationTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new AppError(400, 'AI_CONVERSATION_TITLE_REQUIRED', 'Conversation title is required');
  return normalized.slice(0, 255);
}

async function getOwnedConversation(db: DbLike, userId: string, conversationId: string) {
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function assertOwnedConversation(db: DbLike, userId: string, conversationId: string): Promise<void> {
  const conversation = await getOwnedConversation(db, userId, conversationId);
  if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');
}

async function createConversation(
  db: DbLike,
  input: { userId: string; title: string; lastContext: Record<string, unknown> | null }
) {
  const [conversation] = await db
    .insert(aiConversations)
    .values({
      userId: input.userId,
      title: input.title,
      lastContext: input.lastContext,
      discoveredToolsets: [],
      updatedAt: new Date(),
    })
    .returning();
  return conversation;
}

async function resolveUniqueTitle(db: DbLike, userId: string, title: string): Promise<string> {
  let candidate = title;
  for (let copy = 2; ; copy += 1) {
    const rows = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(eq(aiConversations.userId, userId), eq(aiConversations.title, candidate)))
      .limit(1);
    if (rows.length === 0) return candidate;

    const suffix = ` (${copy})`;
    candidate = `${title.slice(0, 255 - suffix.length)}${suffix}`;
  }
}

async function findRunByCommand(
  db: DbLike,
  userId: string,
  conversationId: string,
  clientCommandId: string
): Promise<AIRun | null> {
  const rows = await db
    .select()
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.userId, userId),
        eq(aiRuns.conversationId, conversationId),
        eq(aiRuns.clientCommandId, clientCommandId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findRunByUserCommand(db: DbLike, userId: string, clientCommandId: string): Promise<AIRun | null> {
  const rows = await db
    .select()
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), eq(aiRuns.clientCommandId, clientCommandId)))
    .limit(1);
  return rows[0] ?? null;
}

async function getActiveRunForUpdate(db: DbLike, conversationId: string): Promise<AIRun | null> {
  const rows = await db
    .select()
    .from(aiRuns)
    .where(and(eq(aiRuns.conversationId, conversationId), inArray(aiRuns.status, ACTIVE_RUN_STATUSES)))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function nextMessageSequence(db: DbLike, conversationId: string): Promise<number> {
  const rows = await db
    .select({ sequence: aiConversationMessages.sequence })
    .from(aiConversationMessages)
    .where(eq(aiConversationMessages.conversationId, conversationId))
    .orderBy(desc(aiConversationMessages.sequence))
    .limit(1);
  return (rows[0]?.sequence ?? -1) + 1;
}

function toConversationMessage(conversationId: string, message: Record<string, unknown>, sequence: number) {
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : null;
  return {
    conversationId,
    sequence,
    role: typeof message.role === 'string' ? message.role : 'user',
    content: typeof message.content === 'string' ? message.content : '',
    uiMessage: { ...message, role: typeof message.role === 'string' ? message.role : 'user' },
    toolCalls,
    toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : null,
    toolName: typeof message.toolName === 'string' ? message.toolName : null,
    toolArgsCompact: null,
    toolResultRaw: null,
    toolResultCompact: null,
    toolResultSizeBytes: estimateJsonSize(toolCalls),
    isSensitive: false,
  };
}

function toSnapshotMessage(id: string, sequence: number, uiMessage: unknown, createdAt: Date): Record<string, unknown> {
  if (!uiMessage || typeof uiMessage !== 'object' || Array.isArray(uiMessage)) {
    return { id, sequence, content: String(uiMessage ?? ''), createdAt: createdAt.toISOString() };
  }
  return {
    ...(uiMessage as Record<string, unknown>),
    id,
    sequence,
    createdAt: createdAt.toISOString(),
  };
}

function withAssistantDraftMessage(
  messages: Record<string, unknown>[],
  activeRun: AIRun | null
): Record<string, unknown>[] {
  const content = activeRun?.assistantDraftContent;
  if (!content) return messages;
  const sequence =
    messages.reduce(
      (max, message, index) => Math.max(max, typeof message.sequence === 'number' ? message.sequence : index),
      -1
    ) + 1;
  return [
    ...messages,
    {
      id: `${activeRun.id}:draft`,
      sequence,
      role: 'assistant',
      content,
      createdAt: activeRun.updatedAt.toISOString(),
      isStreaming: true,
    },
  ];
}

function estimateJsonSize(value: unknown): number {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}
