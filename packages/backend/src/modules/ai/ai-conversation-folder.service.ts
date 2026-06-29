import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { aiConversationFolders, aiConversations } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AIConversationSearchService } from './ai-conversation-search.service.js';

const MAX_FOLDER_NAME_LENGTH = 255;
const MAX_FOLDER_DESCRIPTION_LENGTH = 2000;

export interface AIConversationFolderDto {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAIConversationFolderInput {
  name: string;
  description?: string;
}

export interface UpdateAIConversationFolderInput {
  name?: string;
  description?: string;
}

export interface ReorderAIConversationFoldersInput {
  items: Array<{ id: string; sortOrder: number }>;
}

export interface MoveAIConversationsToFolderInput {
  conversationIds: string[];
  folderId: string | null;
}

export class AIConversationFolderService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly searchService?: AIConversationSearchService
  ) {}

  async listFolders(userId: string): Promise<AIConversationFolderDto[]> {
    return this.db
      .select()
      .from(aiConversationFolders)
      .where(eq(aiConversationFolders.userId, userId))
      .orderBy(asc(aiConversationFolders.sortOrder), asc(aiConversationFolders.createdAt));
  }

  async createFolder(userId: string, input: CreateAIConversationFolderInput): Promise<AIConversationFolderDto> {
    const [folder] = await this.db
      .insert(aiConversationFolders)
      .values({
        userId,
        name: normalizeFolderName(input.name),
        description: normalizeFolderDescription(input.description),
        sortOrder: await this.getNextSortOrder(userId),
      })
      .returning();
    if (!folder) throw new AppError(500, 'AI_FOLDER_CREATE_FAILED', 'AI conversation folder was not created');
    return folder;
  }

  async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateAIConversationFolderInput
  ): Promise<AIConversationFolderDto> {
    const existing = await this.getOwnedFolder(userId, folderId);
    if (!existing) throw new AppError(404, 'AI_FOLDER_NOT_FOUND', 'AI conversation folder not found');

    const [folder] = await this.db
      .update(aiConversationFolders)
      .set({
        name: input.name !== undefined ? normalizeFolderName(input.name) : existing.name,
        description:
          input.description !== undefined ? normalizeFolderDescription(input.description) : existing.description,
        updatedAt: new Date(),
      })
      .where(and(eq(aiConversationFolders.id, folderId), eq(aiConversationFolders.userId, userId)))
      .returning();
    if (!folder) throw new AppError(404, 'AI_FOLDER_NOT_FOUND', 'AI conversation folder not found');
    return folder;
  }

  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const [deleted] = await this.db
      .delete(aiConversationFolders)
      .where(and(eq(aiConversationFolders.id, folderId), eq(aiConversationFolders.userId, userId)))
      .returning({ id: aiConversationFolders.id });
    if (!deleted) throw new AppError(404, 'AI_FOLDER_NOT_FOUND', 'AI conversation folder not found');
  }

  async reorderFolders(userId: string, input: ReorderAIConversationFoldersInput): Promise<AIConversationFolderDto[]> {
    const items = dedupeReorderItems(input.items);
    if (items.length === 0) return this.listFolders(userId);

    const folders = await this.db
      .select({ id: aiConversationFolders.id })
      .from(aiConversationFolders)
      .where(
        and(
          eq(aiConversationFolders.userId, userId),
          inArray(
            aiConversationFolders.id,
            items.map((item) => item.id)
          )
        )
      );
    if (folders.length !== items.length) {
      throw new AppError(404, 'AI_FOLDER_NOT_FOUND', 'One or more AI conversation folders were not found');
    }

    await this.db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(aiConversationFolders)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(and(eq(aiConversationFolders.id, item.id), eq(aiConversationFolders.userId, userId)));
      }
    });
    return this.listFolders(userId);
  }

  async moveConversationsToFolder(userId: string, input: MoveAIConversationsToFolderInput): Promise<{ moved: number }> {
    const conversationIds = [...new Set(input.conversationIds.filter(Boolean))];
    if (conversationIds.length === 0) return { moved: 0 };

    if (input.folderId) {
      const folder = await this.getOwnedFolder(userId, input.folderId);
      if (!folder) throw new AppError(404, 'AI_FOLDER_NOT_FOUND', 'AI conversation folder not found');
    }

    const conversations = await this.db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(eq(aiConversations.userId, userId), inArray(aiConversations.id, conversationIds)));
    if (conversations.length !== conversationIds.length) {
      throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'One or more AI conversations were not found');
    }

    const updated = await this.db
      .update(aiConversations)
      .set({ folderId: input.folderId, updatedAt: new Date() })
      .where(and(eq(aiConversations.userId, userId), inArray(aiConversations.id, conversationIds)))
      .returning({ id: aiConversations.id });
    this.searchService?.updateConversationProjectIndexBestEffort(
      userId,
      updated.map((conversation) => conversation.id),
      input.folderId
    );
    return { moved: updated.length };
  }

  private async getOwnedFolder(userId: string, folderId: string) {
    return this.db.query.aiConversationFolders.findFirst({
      where: and(eq(aiConversationFolders.id, folderId), eq(aiConversationFolders.userId, userId)),
    });
  }

  private async getNextSortOrder(userId: string): Promise<number> {
    const rows = await this.db
      .select({ sortOrder: aiConversationFolders.sortOrder })
      .from(aiConversationFolders)
      .where(eq(aiConversationFolders.userId, userId))
      .orderBy(desc(aiConversationFolders.sortOrder))
      .limit(1);
    return rows.length > 0 ? rows[0].sortOrder + 1 : 0;
  }
}

function normalizeFolderName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new AppError(400, 'AI_FOLDER_NAME_REQUIRED', 'AI conversation folder name is required');
  return normalized.slice(0, MAX_FOLDER_NAME_LENGTH);
}

function normalizeFolderDescription(description: string | undefined): string {
  return (description ?? '').trim().slice(0, MAX_FOLDER_DESCRIPTION_LENGTH);
}

function dedupeReorderItems(items: ReorderAIConversationFoldersInput['items']) {
  const seen = new Set<string>();
  const result: ReorderAIConversationFoldersInput['items'] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ id: item.id, sortOrder: item.sortOrder });
  }
  return result;
}
