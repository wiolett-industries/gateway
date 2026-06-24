import { and, asc, desc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { aiConversationMessages, aiConversations } from '@/db/schema/index.js';
import type { PageContext } from './ai.types.js';

export interface AIConversationSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
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
}

export class AIConversationService {
  constructor(private readonly db: DrizzleClient) {}

  async listConversations(userId: string): Promise<AIConversationSummary[]> {
    const rows = await this.db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.updatedAt));

    const counts = await Promise.all(rows.map((row) => this.countMessages(row.id)));
    return rows.map((row, index) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: counts[index],
    }));
  }

  async getConversation(userId: string, conversationId: string): Promise<AIConversationDetail | null> {
    const row = await this.getOwnedConversation(userId, conversationId);
    if (!row) return null;
    const messages = await this.loadMessages(row.id);
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: messages.length,
      messages,
      lastContext: row.lastContext,
      discoveredToolsets: row.discoveredToolsets,
      checkpoint: row.checkpoint,
    };
  }

  async saveConversation(userId: string, input: SaveAIConversationInput): Promise<AIConversationDetail> {
    const title = normalizeTitle(input.title);
    const now = new Date();
    const lastContext = normalizeContext(input.lastContext);

    const existing = await this.db.query.aiConversations.findFirst({
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
      if (input.messages.length > 0) {
        await tx
          .insert(aiConversationMessages)
          .values(input.messages.map((message, index) => toConversationMessage(conversationId!, message, index)));
      }
    });

    const saved = await this.getConversation(userId, conversationId!);
    if (!saved) throw new Error('Failed to save conversation');
    return saved;
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    input: Partial<SaveAIConversationInput>
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
          updatedAt: now,
        })
        .where(eq(aiConversations.id, existing.id));

      if (input.messages) {
        await tx.delete(aiConversationMessages).where(eq(aiConversationMessages.conversationId, existing.id));
        if (input.messages.length > 0) {
          await tx
            .insert(aiConversationMessages)
            .values(input.messages.map((message, index) => toConversationMessage(existing.id, message, index)));
        }
      }
    });

    return this.getConversation(userId, conversationId);
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const [deleted] = await this.db
      .delete(aiConversations)
      .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
      .returning({ id: aiConversations.id });
    return !!deleted;
  }

  async deleteConversationByTitle(userId: string, title: string): Promise<boolean> {
    const [deleted] = await this.db
      .delete(aiConversations)
      .where(and(eq(aiConversations.userId, userId), eq(aiConversations.title, normalizeTitle(title))))
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

  private async countMessages(conversationId: string): Promise<number> {
    const rows = await this.db
      .select({ id: aiConversationMessages.id })
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.conversationId, conversationId));
    return rows.length;
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
