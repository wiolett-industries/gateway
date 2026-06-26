import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import {
  type AIRunStatus,
  aiConversationMessages,
  aiConversations,
  aiRunQuestions,
  aiRuns,
  aiRunToolCalls,
} from '@/db/schema/index.js';
import type { AISandboxService } from './ai.sandbox.service.js';
import type { AISandboxArtifactService } from './ai.sandbox-artifact.service.js';
import type { AIConversationStatus, PageContext } from './ai.types.js';

const RETAIN_FULL_TOOL_OUTPUT_COUNT = 10;
const ACTIVE_RUN_STATUSES = ['queued', 'running', 'waiting_for_approval', 'waiting_for_answer'] as const;

export interface AIConversationSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  status: AIConversationStatus;
  blockReason: string | null;
  activeRunStatus: AIRunStatus | null;
}

export interface AIConversationDetail extends AIConversationSummary {
  messages: unknown[];
  lastContext: Record<string, unknown> | null;
  discoveredToolsets: string[];
  checkpoint: Record<string, unknown> | null;
}

export interface SaveAIConversationInput {
  title: string;
  messages: unknown[];
  lastContext?: PageContext | Record<string, unknown> | null;
  createNew?: boolean;
}

export interface AIConversationRuntimeStateInput {
  lastContext?: PageContext | Record<string, unknown> | null;
  discoveredToolsets?: string[];
  checkpoint?: Record<string, unknown> | null;
}

export class AIConversationService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly cleanup?: {
      artifacts: AISandboxArtifactService;
      sandbox: AISandboxService;
    }
  ) {}

  async listConversations(userId: string): Promise<AIConversationSummary[]> {
    const rows = await this.db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.updatedAt));

    const [messagesByRow, activeRuns] = await Promise.all([
      Promise.all(rows.map((row) => this.loadMessages(row.id))),
      rows.length > 0
        ? this.db
            .select()
            .from(aiRuns)
            .where(
              and(
                eq(aiRuns.userId, userId),
                inArray(
                  aiRuns.conversationId,
                  rows.map((row) => row.id)
                ),
                inArray(aiRuns.status, ACTIVE_RUN_STATUSES)
              )
            )
        : Promise.resolve([]),
    ]);
    const activeRunStatusByConversation = new Map(activeRuns.map((run) => [run.conversationId, run.status]));
    return rows.map((row, index) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: countVisibleMessages(messagesByRow[index]),
      ...deriveConversationStatus(messagesByRow[index]),
      activeRunStatus: activeRunStatusByConversation.get(row.id) ?? null,
    }));
  }

  async getConversation(userId: string, conversationId: string): Promise<AIConversationDetail | null> {
    const row = await this.getOwnedConversation(userId, conversationId);
    if (!row) return null;
    const [messages, activeRuns] = await Promise.all([
      this.loadMessages(row.id),
      this.db
        .select()
        .from(aiRuns)
        .where(
          and(eq(aiRuns.userId, userId), eq(aiRuns.conversationId, row.id), inArray(aiRuns.status, ACTIVE_RUN_STATUSES))
        )
        .limit(1),
    ]);
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: countVisibleMessages(messages),
      ...deriveConversationStatus(messages),
      activeRunStatus: activeRuns[0]?.status ?? null,
      messages,
      lastContext: row.lastContext,
      discoveredToolsets: row.discoveredToolsets,
      checkpoint: row.checkpoint,
    };
  }

  async listConversationTitles(userId: string, conversationIds: string[]): Promise<Record<string, string>> {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return {};
    const rows = await this.db
      .select({ id: aiConversations.id, title: aiConversations.title })
      .from(aiConversations)
      .where(and(eq(aiConversations.userId, userId), inArray(aiConversations.id, ids)));
    return Object.fromEntries(rows.map((row) => [row.id, row.title]));
  }

  async saveConversation(userId: string, input: SaveAIConversationInput): Promise<AIConversationDetail> {
    let title = normalizeTitle(input.title);
    const now = new Date();
    const lastContext = normalizeContext(input.lastContext);
    const messages = sanitizeConversationMessagesForStorage(input.messages);

    if (input.createNew) {
      title = await this.resolveUniqueTitle(userId, title);
    }

    const existing = input.createNew
      ? null
      : await this.db.query.aiConversations.findFirst({
          where: and(eq(aiConversations.userId, userId), eq(aiConversations.title, title)),
        });

    let conversationId = existing?.id;
    await this.db.transaction(async (tx) => {
      if (conversationId) {
        await tx
          .update(aiConversations)
          .set({ lastContext: lastContext ?? existing?.lastContext ?? null, updatedAt: now })
          .where(eq(aiConversations.id, conversationId));
      } else {
        const [created] = await tx
          .insert(aiConversations)
          .values({
            userId,
            title,
            lastContext,
            discoveredToolsets: [],
            updatedAt: now,
          })
          .returning({ id: aiConversations.id });
        conversationId = created.id;
      }

      await tx.delete(aiConversationMessages).where(eq(aiConversationMessages.conversationId, conversationId!));
      if (messages.length > 0) {
        await tx
          .insert(aiConversationMessages)
          .values(messages.map((message, index) => toConversationMessage(conversationId!, message, index)));
      }
    });

    await this.attachArtifactsFromMessages(userId, conversationId!, messages);
    const saved = await this.getConversation(userId, conversationId!);
    if (!saved) throw new Error('Failed to save conversation');
    return saved;
  }

  private async resolveUniqueTitle(userId: string, title: string): Promise<string> {
    let candidate = title;
    for (let copy = 2; ; copy += 1) {
      const existing = await this.db.query.aiConversations.findFirst({
        where: and(eq(aiConversations.userId, userId), eq(aiConversations.title, candidate)),
      });
      if (!existing) return candidate;

      const suffix = ` (${copy})`;
      candidate = `${title.slice(0, 255 - suffix.length)}${suffix}`;
    }
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    input: Partial<SaveAIConversationInput> & AIConversationRuntimeStateInput
  ): Promise<AIConversationDetail | null> {
    const existing = await this.getOwnedConversation(userId, conversationId);
    if (!existing) return null;
    const now = new Date();
    const lastContext = normalizeContext(input.lastContext);

    await this.db.transaction(async (tx) => {
      await tx
        .update(aiConversations)
        .set({
          title: input.title ? normalizeTitle(input.title) : existing.title,
          lastContext: input.lastContext !== undefined ? lastContext : existing.lastContext,
          discoveredToolsets:
            input.discoveredToolsets !== undefined
              ? normalizeToolsets(input.discoveredToolsets)
              : existing.discoveredToolsets,
          checkpoint: input.checkpoint !== undefined ? input.checkpoint : existing.checkpoint,
          updatedAt: now,
        })
        .where(eq(aiConversations.id, existing.id));

      if (input.messages) {
        const messages = sanitizeConversationMessagesForStorage(input.messages);
        await tx.delete(aiConversationMessages).where(eq(aiConversationMessages.conversationId, existing.id));
        if (messages.length > 0) {
          await tx
            .insert(aiConversationMessages)
            .values(messages.map((message, index) => toConversationMessage(existing.id, message, index)));
        }
      }
    });

    if (input.messages) {
      await this.attachArtifactsFromMessages(
        userId,
        conversationId,
        sanitizeConversationMessagesForStorage(input.messages)
      );
    }
    return this.getConversation(userId, conversationId);
  }

  async updateRuntimeState(
    userId: string,
    conversationId: string,
    input: AIConversationRuntimeStateInput
  ): Promise<AIConversationDetail | null> {
    const existing = await this.getOwnedConversation(userId, conversationId);
    if (!existing) return null;

    const discoveredToolsets =
      input.discoveredToolsets === undefined
        ? existing.discoveredToolsets
        : normalizeToolsets([...existing.discoveredToolsets, ...input.discoveredToolsets]);

    await this.db
      .update(aiConversations)
      .set({
        lastContext: input.lastContext !== undefined ? normalizeContext(input.lastContext) : existing.lastContext,
        discoveredToolsets,
        checkpoint: input.checkpoint !== undefined ? input.checkpoint : existing.checkpoint,
        updatedAt: new Date(),
      })
      .where(eq(aiConversations.id, existing.id));

    return this.getConversation(userId, conversationId);
  }

  async rollbackToMessage(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<{ message: unknown; conversation: AIConversationDetail } | null> {
    const existing = await this.getOwnedConversation(userId, conversationId);
    if (!existing) return null;

    const [activeRun] = await this.db
      .select({ id: aiRuns.id })
      .from(aiRuns)
      .where(and(eq(aiRuns.conversationId, conversationId), inArray(aiRuns.status, [...ACTIVE_RUN_STATUSES])))
      .limit(1);
    if (activeRun) throw new Error('Conversation already has an active AI run');

    const [target] = await this.db
      .select({
        id: aiConversationMessages.id,
        sequence: aiConversationMessages.sequence,
        role: aiConversationMessages.role,
        uiMessage: aiConversationMessages.uiMessage,
      })
      .from(aiConversationMessages)
      .where(and(eq(aiConversationMessages.conversationId, conversationId), eq(aiConversationMessages.id, messageId)))
      .limit(1);

    if (!target || target.role !== 'user') return null;

    await this.db.transaction(async (tx) => {
      const deletedMessages = await tx
        .select({ id: aiConversationMessages.id })
        .from(aiConversationMessages)
        .where(
          and(
            eq(aiConversationMessages.conversationId, conversationId),
            gte(aiConversationMessages.sequence, target.sequence)
          )
        );
      const deletedMessageIds = deletedMessages.map((message) => message.id);

      const deletedRuns =
        deletedMessageIds.length > 0
          ? await tx
              .select({ id: aiRuns.id })
              .from(aiRuns)
              .where(and(eq(aiRuns.conversationId, conversationId), inArray(aiRuns.activeMessageId, deletedMessageIds)))
          : [];
      const deletedRunIds = deletedRuns.map((run) => run.id);

      if (deletedRunIds.length > 0) {
        await tx.delete(aiRunQuestions).where(inArray(aiRunQuestions.runId, deletedRunIds));
        await tx.delete(aiRunToolCalls).where(inArray(aiRunToolCalls.runId, deletedRunIds));
        await tx.delete(aiRuns).where(inArray(aiRuns.id, deletedRunIds));
      }
      if (deletedMessageIds.length > 0) {
        await tx.delete(aiConversationMessages).where(inArray(aiConversationMessages.id, deletedMessageIds));
      }
      await tx
        .update(aiConversations)
        .set({ checkpoint: null, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversationId));
    });

    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) return null;
    return { message: target.uiMessage, conversation };
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const existing = await this.getOwnedConversation(userId, conversationId);
    if (!existing) return false;
    await this.cleanupConversationResources(userId, existing.id);
    const [deleted] = await this.db
      .delete(aiConversations)
      .where(and(eq(aiConversations.id, existing.id), eq(aiConversations.userId, userId)))
      .returning({ id: aiConversations.id });
    return !!deleted;
  }

  async deleteConversationByTitle(userId: string, title: string): Promise<boolean> {
    const existing = await this.db.query.aiConversations.findFirst({
      where: and(eq(aiConversations.userId, userId), eq(aiConversations.title, normalizeTitle(title))),
    });
    if (!existing) return false;
    await this.cleanupConversationResources(userId, existing.id);
    const [deleted] = await this.db
      .delete(aiConversations)
      .where(and(eq(aiConversations.userId, userId), eq(aiConversations.id, existing.id)))
      .returning({ id: aiConversations.id });
    return !!deleted;
  }

  private async getOwnedConversation(userId: string, conversationId: string) {
    return this.db.query.aiConversations.findFirst({
      where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)),
    });
  }

  private async loadMessages(conversationId: string): Promise<unknown[]> {
    const rows = await this.db
      .select()
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.conversationId, conversationId))
      .orderBy(asc(aiConversationMessages.sequence));
    return rows.map((row) => row.uiMessage);
  }

  private async cleanupConversationResources(userId: string, conversationId: string): Promise<void> {
    if (!this.cleanup) return;
    await Promise.all([
      this.cleanup.artifacts.deleteForConversation(userId, conversationId),
      this.cleanup.sandbox.killConversationJobs(userId, conversationId),
    ]);
  }

  private async attachArtifactsFromMessages(
    userId: string,
    conversationId: string,
    messages: unknown[]
  ): Promise<void> {
    if (!this.cleanup) return;
    const artifactIds = collectConversationArtifactIds(messages);
    await this.cleanup.artifacts.syncConversationArtifacts(userId, artifactIds, conversationId);
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Conversation title is required');
  return normalized.slice(0, 255);
}

function normalizeContext(context: SaveAIConversationInput['lastContext']): Record<string, unknown> | null {
  if (!context) return null;
  return { ...context };
}

function normalizeToolsets(toolsets: string[]): string[] {
  return [...new Set(toolsets.map((toolset) => toolset.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function sanitizeConversationMessagesForStorage(messages: unknown[]): unknown[] {
  const retainedToolCallIds = collectRetainedToolCallIds(messages);
  return messages.map((message) => sanitizeConversationMessage(message, retainedToolCallIds));
}

function collectRetainedToolCallIds(messages: unknown[]): Set<string> {
  const toolCallIds: string[] = [];
  for (const message of messages) {
    const record = toRecord(message);
    if (!record || !Array.isArray(record.toolCalls)) continue;
    for (const toolCall of record.toolCalls) {
      const toolRecord = toRecord(toolCall);
      if (!toolRecord || toolRecord.name === 'ask_question' || typeof toolRecord.id !== 'string') continue;
      toolCallIds.push(toolRecord.id);
    }
  }
  return new Set(toolCallIds.slice(-RETAIN_FULL_TOOL_OUTPUT_COUNT));
}

function sanitizeConversationMessage(message: unknown, retainedToolCallIds: Set<string>): unknown {
  const record = toRecord(message);
  if (!record || !Array.isArray(record.toolCalls)) return message;
  return {
    ...record,
    toolCalls: record.toolCalls.map((toolCall) => sanitizeToolCall(toolCall, retainedToolCallIds)),
  };
}

function sanitizeToolCall(toolCall: unknown, retainedToolCallIds: Set<string>): unknown {
  const record = toRecord(toolCall);
  if (!record || record.name === 'ask_question' || typeof record.id !== 'string') return toolCall;
  if (retainedToolCallIds.has(record.id) || !Object.hasOwn(record, 'result')) return toolCall;
  return {
    ...record,
    result: {
      summary: 'Tool output omitted from saved conversation after the latest 10 tool calls.',
      fullOutputOmitted: true,
    },
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function deriveConversationStatus(messages: unknown[]): { status: AIConversationStatus; blockReason: string | null } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const record = toRecord(messages[i]);
    if (!record || typeof record.conversationStatus !== 'string') continue;
    if (record.conversationStatus === 'ended' || record.conversationStatus === 'context_blocked') {
      return {
        status: record.conversationStatus,
        blockReason: typeof record.blockReason === 'string' ? record.blockReason : null,
      };
    }
  }
  return { status: 'active', blockReason: null };
}

function countVisibleMessages(messages: unknown[]): number {
  return messages.filter((message) => !toRecord(message)?.conversationStatus).length;
}

function collectConversationArtifactIds(messages: unknown[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    const record = toRecord(message);
    if (!record) continue;
    if (Array.isArray(record.attachments)) {
      for (const attachment of record.attachments) {
        const attachmentRecord = toRecord(attachment);
        if (typeof attachmentRecord?.artifactId === 'string') ids.push(attachmentRecord.artifactId);
      }
    }
    if (Array.isArray(record.toolCalls)) {
      for (const toolCall of record.toolCalls) {
        const toolRecord = toRecord(toolCall);
        if (toolRecord?.name !== 'send_artifact') continue;
        const result = toRecord(toolRecord.result);
        if (typeof result?.artifactId === 'string') ids.push(result.artifactId);
      }
    }
  }
  return ids;
}

function toConversationMessage(conversationId: string, message: unknown, index: number) {
  const record = typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : {};
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : null;
  return {
    conversationId,
    sequence: index,
    role: typeof record.role === 'string' ? record.role : 'assistant',
    content: typeof record.content === 'string' ? record.content : '',
    uiMessage: record,
    toolCalls,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : null,
    toolName: typeof record.toolName === 'string' ? record.toolName : null,
    toolArgsCompact: null,
    toolResultRaw: extractToolResults(toolCalls),
    toolResultCompact: null,
    toolResultSizeBytes: estimateJsonSize(toolCalls),
    isSensitive: false,
  };
}

function extractToolResults(toolCalls: unknown[] | null): unknown {
  if (!toolCalls) return null;
  return toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== 'object') return null;
    const record = toolCall as Record<string, unknown>;
    return { id: record.id, name: record.name, result: record.result, error: record.error };
  });
}

function estimateJsonSize(value: unknown): number {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}
