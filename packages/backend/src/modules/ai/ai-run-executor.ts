import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { container } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import {
  type AIRun,
  type AIRunQuestion,
  type AIRunToolCall,
  aiConversationMessages,
  aiConversations,
  aiRunQuestions,
  aiRuns,
  aiRunToolCalls,
} from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { User } from '@/types.js';
import { AIService } from './ai.service.js';
import type { ChatMessage, WSServerMessage } from './ai.types.js';
import { classifyAIToolForApproval } from './ai-approval-policy.js';
import {
  normalizeCheckpoint,
  questionTextFromArgs,
  toChatMessage,
  toCheckpoint,
  toPageContext,
} from './ai-run-runtime.helpers.js';

const logger = createChildLogger('AI-Run-Executor');

type PublishConversationChanged = (userId: string, conversationId: string, invalidatedStores?: string[]) => void;

interface ApprovalContinuationInput {
  conversationId: string;
  runId: string;
  toolCall: AIRunToolCall;
  approved: boolean;
}

interface QuestionContinuationInput {
  conversationId: string;
  runId: string;
  question: AIRunQuestion;
}

interface ResumeInput {
  conversationId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  approved: boolean;
  pendingMessages: Record<string, unknown>[];
  answers?: Record<string, string>;
  queuedApprovals: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export class AIRunExecutor {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly executingRuns = new Set<string>();

  constructor(
    private readonly db: DrizzleClient,
    private readonly publishConversationChanged: PublishConversationChanged
  ) {}

  startRunExecution(user: User, runId: string): void {
    if (this.executingRuns.has(runId)) return;
    this.executingRuns.add(runId);
    void this.executeRun(user, runId).catch((error) => {
      this.logExecutionError(runId, error);
    });
  }

  startApprovalContinuation(user: User, input: ApprovalContinuationInput): void {
    if (this.executingRuns.has(input.runId)) return;
    this.executingRuns.add(input.runId);
    void this.executeApprovalContinuation(user, input).catch((error) => {
      this.logExecutionError(input.runId, error);
    });
  }

  startQuestionContinuation(user: User, input: QuestionContinuationInput): void {
    if (this.executingRuns.has(input.runId)) return;
    this.executingRuns.add(input.runId);
    void this.executeQuestionContinuation(user, input).catch((error) => {
      this.logExecutionError(input.runId, error);
    });
  }

  abortRun(runId: string): void {
    this.abortControllers.get(runId)?.abort();
    this.abortControllers.delete(runId);
    this.executingRuns.delete(runId);
  }

  private async executeRun(user: User, runId: string): Promise<void> {
    const run = await this.getOwnedRun(user.id, runId);
    if (!run) throw new AppError(404, 'AI_RUN_NOT_FOUND', 'AI run not found');
    if (run.status !== 'queued') return;

    const conversation = await getOwnedConversation(this.db, user.id, run.conversationId);
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');

    const abortController = new AbortController();
    this.abortControllers.set(run.id, abortController);
    await this.updateRunStatus(run.id, 'running');
    this.publishConversationChanged(user.id, run.conversationId);

    const messages = await this.loadConversationMessages(run.conversationId);
    const pageContext = toPageContext(conversation.lastContext);
    const aiService = container.resolve(AIService);
    let assistantContent = '';
    let assistantMessageWritten = false;

    try {
      for await (const event of aiService.streamChat(
        user,
        messages,
        pageContext,
        abortController.signal,
        run.id,
        run.conversationId
      )) {
        if (abortController.signal.aborted) return;

        const result = await this.applyRuntimeEvent({
          user,
          run,
          event,
          assistantContent,
          assistantMessageWritten,
        });
        assistantContent = result.assistantContent;
        assistantMessageWritten = result.assistantMessageWritten;
        if (result.done) return;
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      const assistantMessageId = await this.persistAssistantMessageIfNeeded(run.conversationId, assistantContent);
      if (assistantMessageId) await this.linkRunToolCallsToAssistantMessage(run.id, assistantMessageId);
      await this.clearAssistantDraft(run.id);
      await this.updateRunStatus(run.id, 'failed', error instanceof Error ? error.message : 'AI run failed');
      this.publishConversationChanged(user.id, run.conversationId);
    } finally {
      this.abortControllers.delete(run.id);
      this.executingRuns.delete(run.id);
    }
  }

  private async executeApprovalContinuation(user: User, input: ApprovalContinuationInput): Promise<void> {
    const checkpoint = await this.loadCheckpoint(user.id, input.conversationId);
    await this.executeResume(user, {
      conversationId: input.conversationId,
      runId: input.runId,
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.toolName,
      toolArgs: input.toolCall.toolArgs,
      approved: input.approved,
      pendingMessages: checkpoint.pendingMessages,
      queuedApprovals: checkpoint.queuedApprovals,
    });
  }

  private async executeQuestionContinuation(user: User, input: QuestionContinuationInput): Promise<void> {
    const checkpoint = await this.loadCheckpoint(user.id, input.conversationId);
    const answeredQuestions = await this.listAnsweredQuestions(input.runId);
    const answers = Object.fromEntries(
      answeredQuestions.map((question) => [question.toolCallId, question.answer ?? 'No answer provided'])
    );
    if (!answers[input.question.toolCallId]) {
      answers[input.question.toolCallId] = input.question.answer ?? 'No answer provided';
    }
    const firstQuestion = checkpoint.allQuestions[0] ?? {
      id: input.question.toolCallId,
      args: { question: input.question.question },
    };
    await this.executeResume(user, {
      conversationId: input.conversationId,
      runId: input.runId,
      toolCallId: firstQuestion.id,
      toolName: 'ask_question',
      toolArgs: firstQuestion.args,
      approved: true,
      pendingMessages: checkpoint.pendingMessages,
      answers,
      queuedApprovals: checkpoint.queuedApprovals,
    });
  }

  private async executeResume(user: User, input: ResumeInput): Promise<void> {
    const run = await this.getOwnedRun(user.id, input.runId);
    if (!run) throw new AppError(404, 'AI_RUN_NOT_FOUND', 'AI run not found');
    if (run.status !== 'waiting_for_approval' && run.status !== 'waiting_for_answer') return;

    const conversation = await getOwnedConversation(this.db, user.id, input.conversationId);
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');

    const abortController = new AbortController();
    this.abortControllers.set(input.runId, abortController);
    await this.updateRunStatus(input.runId, 'running');
    this.publishConversationChanged(user.id, input.conversationId);

    const aiService = container.resolve(AIService);
    const pageContext = toPageContext(conversation.lastContext);
    let assistantContent = '';
    let assistantMessageWritten = false;

    try {
      for await (const event of aiService.resumeAfterApproval(
        user,
        input.toolCallId,
        input.toolName,
        input.toolArgs,
        input.approved,
        input.pendingMessages,
        pageContext,
        abortController.signal,
        input.runId,
        undefined,
        input.answers,
        input.queuedApprovals,
        input.conversationId
      )) {
        if (abortController.signal.aborted) return;

        const result = await this.applyRuntimeEvent({
          user,
          run,
          event,
          assistantContent,
          assistantMessageWritten,
        });
        assistantContent = result.assistantContent;
        assistantMessageWritten = result.assistantMessageWritten;
        if (result.done) return;
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      const assistantMessageId = await this.persistAssistantMessageIfNeeded(input.conversationId, assistantContent);
      if (assistantMessageId) await this.linkRunToolCallsToAssistantMessage(input.runId, assistantMessageId);
      await this.clearAssistantDraft(input.runId);
      await this.updateRunStatus(input.runId, 'failed', error instanceof Error ? error.message : 'AI run failed');
      this.publishConversationChanged(user.id, input.conversationId);
    } finally {
      this.abortControllers.delete(input.runId);
      this.executingRuns.delete(input.runId);
    }
  }

  private async applyRuntimeEvent(input: {
    user: User;
    run: AIRun;
    event: WSServerMessage;
    assistantContent: string;
    assistantMessageWritten: boolean;
  }): Promise<{ assistantContent: string; assistantMessageWritten: boolean; done: boolean }> {
    let { assistantContent, assistantMessageWritten } = input;
    const { user, run, event } = input;

    if (event.type === 'text_delta') {
      assistantContent += event.content;
      await this.updateAssistantDraft(run.id, assistantContent);
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: false };
    }

    if (event.type === 'tool_call_start') {
      await this.recordToolCall({
        runId: run.id,
        conversationId: run.conversationId,
        toolCallId: event.id,
        toolName: event.name,
        toolArgs: event.arguments,
        status: 'running',
      });
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: false };
    }

    if (event.type === 'tool_result') {
      await this.finishToolCall(run.id, event.id, event.result, event.error ?? null);
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: false };
    }

    if (event.type === 'invalidate_stores') {
      this.publishConversationChanged(user.id, run.conversationId, event.stores);
      return { assistantContent, assistantMessageWritten, done: false };
    }

    if (event.type === 'tool_approval_required') {
      const assistantMessageId = await this.persistAssistantMessageIfNeeded(run.conversationId, assistantContent);
      assistantMessageWritten = true;
      await this.clearAssistantDraft(run.id);
      await this.persistPendingInteraction(run, event, assistantMessageId);
      await this.setConversationCheckpoint(run.conversationId, event);
      await this.updateRunStatus(run.id, event.name === 'ask_question' ? 'waiting_for_answer' : 'waiting_for_approval');
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: true };
    }

    if (event.type === 'error' || event.type === 'context_blocked') {
      const assistantMessageId = await this.persistAssistantMessageIfNeeded(run.conversationId, assistantContent);
      assistantMessageWritten = true;
      if (assistantMessageId) await this.linkRunToolCallsToAssistantMessage(run.id, assistantMessageId);
      await this.clearAssistantDraft(run.id);
      await this.updateRunStatus(run.id, 'failed', event.type === 'error' ? event.message : event.reason);
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: true };
    }

    if (event.type === 'conversation_ended') {
      const assistantMessageId = await this.persistAssistantMessageIfNeeded(run.conversationId, assistantContent);
      assistantMessageWritten = true;
      if (assistantMessageId) await this.linkRunToolCallsToAssistantMessage(run.id, assistantMessageId);
      await this.clearAssistantDraft(run.id);
    }

    if (event.type === 'done') {
      if (!assistantMessageWritten) {
        const assistantMessageId = await this.persistAssistantMessageIfNeeded(run.conversationId, assistantContent);
        if (assistantMessageId) await this.linkRunToolCallsToAssistantMessage(run.id, assistantMessageId);
      }
      await this.clearAssistantDraft(run.id);
      await this.updateRunStatus(run.id, 'completed');
      await this.setConversationCheckpoint(run.conversationId, null);
      this.publishConversationChanged(user.id, run.conversationId);
      return { assistantContent, assistantMessageWritten, done: true };
    }

    return { assistantContent, assistantMessageWritten, done: false };
  }

  private async getOwnedRun(userId: string, runId: string): Promise<AIRun | null> {
    const rows = await this.db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async loadConversationMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select({ uiMessage: aiConversationMessages.uiMessage })
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.conversationId, conversationId))
      .orderBy(asc(aiConversationMessages.sequence));
    return rows
      .map((row) => toChatMessage(row.uiMessage))
      .filter((message): message is ChatMessage => message !== null);
  }

  private async persistAssistantMessageIfNeeded(conversationId: string, content: string): Promise<string | null> {
    if (!content.trim()) return null;
    const sequence = await nextMessageSequence(this.db, conversationId);
    const [message] = await this.db
      .insert(aiConversationMessages)
      .values(
        toConversationMessage(
          conversationId,
          {
            role: 'assistant',
            content,
          },
          sequence
        )
      )
      .returning({ id: aiConversationMessages.id });
    await this.db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
    return message?.id ?? null;
  }

  private async recordToolCall(input: {
    runId: string;
    conversationId: string;
    toolCallId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    assistantMessageId?: string | null;
    status: 'running' | 'pending_approval';
  }): Promise<void> {
    await this.db
      .insert(aiRunToolCalls)
      .values({
        runId: input.runId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId ?? null,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        toolArgs: input.toolArgs,
        classification: classifyAIToolForApproval(input.toolName),
        approvalPolicy: input.status === 'pending_approval' ? 'requires_approval' : 'auto_approved',
        requiredScopes: [],
        status: input.status,
      })
      .onConflictDoUpdate({
        target: [aiRunToolCalls.runId, aiRunToolCalls.toolCallId],
        set: {
          toolName: input.toolName,
          toolArgs: input.toolArgs,
          ...(input.assistantMessageId ? { assistantMessageId: input.assistantMessageId } : {}),
          classification: classifyAIToolForApproval(input.toolName),
          approvalPolicy: input.status === 'pending_approval' ? 'requires_approval' : 'auto_approved',
          status: input.status,
          updatedAt: new Date(),
        },
      });
  }

  private async finishToolCall(
    runId: string,
    toolCallId: string,
    result: unknown,
    error: string | null
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(aiRunToolCalls)
      .set({
        status: error ? 'failed' : 'completed',
        result,
        error,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(aiRunToolCalls.runId, runId), eq(aiRunToolCalls.toolCallId, toolCallId)));
  }

  private async persistPendingInteraction(
    run: AIRun,
    event: Extract<WSServerMessage, { type: 'tool_approval_required' }>,
    assistantMessageId: string | null
  ): Promise<void> {
    if (event.name === 'ask_question') {
      const questions = getQuestionBatch(event);
      await this.db.insert(aiRunQuestions).values(
        questions.map((question) => ({
          runId: run.id,
          conversationId: run.conversationId,
          toolCallId: question.id,
          question: questionTextFromArgs(question.args),
        }))
      );
      return;
    }

    await this.recordToolCall({
      runId: run.id,
      conversationId: run.conversationId,
      assistantMessageId,
      toolCallId: event.id,
      toolName: event.name,
      toolArgs: event.arguments,
      status: 'pending_approval',
    });
  }

  private async setConversationCheckpoint(conversationId: string, event: WSServerMessage | null): Promise<void> {
    await this.db
      .update(aiConversations)
      .set({
        checkpoint: event ? toCheckpoint(event) : null,
        updatedAt: new Date(),
      })
      .where(eq(aiConversations.id, conversationId));
  }

  private async updateAssistantDraft(runId: string, content: string): Promise<void> {
    await this.db
      .update(aiRuns)
      .set({ assistantDraftContent: content, updatedAt: new Date() })
      .where(eq(aiRuns.id, runId));
  }

  private async clearAssistantDraft(runId: string): Promise<void> {
    await this.db
      .update(aiRuns)
      .set({ assistantDraftContent: null, updatedAt: new Date() })
      .where(eq(aiRuns.id, runId));
  }

  private async linkRunToolCallsToAssistantMessage(runId: string, assistantMessageId: string): Promise<void> {
    await this.db
      .update(aiRunToolCalls)
      .set({ assistantMessageId, updatedAt: new Date() })
      .where(and(eq(aiRunToolCalls.runId, runId), isNull(aiRunToolCalls.assistantMessageId)));
  }

  private async listAnsweredQuestions(runId: string): Promise<AIRunQuestion[]> {
    return this.db
      .select()
      .from(aiRunQuestions)
      .where(and(eq(aiRunQuestions.runId, runId), eq(aiRunQuestions.status, 'answered')))
      .orderBy(asc(aiRunQuestions.createdAt));
  }

  private async loadCheckpoint(userId: string, conversationId: string) {
    const conversation = await getOwnedConversation(this.db, userId, conversationId);
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');
    return normalizeCheckpoint(conversation.checkpoint);
  }

  private async updateRunStatus(runId: string, status: AIRun['status'], error?: string | null): Promise<void> {
    const now = new Date();
    const terminal =
      status === 'completed'
        ? { completedAt: now, stoppedAt: null }
        : status === 'stopped'
          ? { completedAt: null, stoppedAt: now }
          : { completedAt: null, stoppedAt: null };
    await this.db
      .update(aiRuns)
      .set({
        status,
        error: error ?? null,
        updatedAt: now,
        startedAt: status === 'running' ? now : undefined,
        ...terminal,
      })
      .where(eq(aiRuns.id, runId));
  }

  private logExecutionError(runId: string, error: unknown): void {
    logger.error('AI run execution failed', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type DbLike = Pick<DrizzleClient, 'select' | 'insert' | 'update'>;

async function getOwnedConversation(db: DbLike, userId: string, conversationId: string) {
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
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

function estimateJsonSize(value: unknown): number {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function getQuestionBatch(
  event: Extract<WSServerMessage, { type: 'tool_approval_required' }>
): Array<{ id: string; args: Record<string, unknown> }> {
  const payload = event as typeof event & { _allQuestions?: unknown };
  if (Array.isArray(payload._allQuestions)) {
    const questions = payload._allQuestions
      .map((question) => {
        if (!question || typeof question !== 'object') return null;
        const record = question as Record<string, unknown>;
        if (typeof record.id !== 'string') return null;
        const args = record.args && typeof record.args === 'object' && !Array.isArray(record.args) ? record.args : {};
        return { id: record.id, args: args as Record<string, unknown> };
      })
      .filter((question): question is { id: string; args: Record<string, unknown> } => question !== null);
    if (questions.length > 0) return questions;
  }

  return [{ id: event.id, args: event.arguments }];
}
