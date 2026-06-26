import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { aiConversationFolders } from './ai-conversation-folders.js';
import { aiConversationMessages, aiConversations } from './ai-conversations.js';
import { users } from './users.js';

export const aiConversationSearchDocuments = pgTable(
  'ai_conversation_search_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => aiConversationFolders.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => aiConversationMessages.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    role: varchar('role', { length: 32 }),
    text: text('text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    tokens: jsonb('tokens').$type<string[]>().notNull().default([]),
    tokenCount: integer('token_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userProjectIdx: index('ai_conversation_search_user_project_idx').on(table.userId, table.projectId),
    conversationIdx: index('ai_conversation_search_conversation_idx').on(table.conversationId),
    messageIdx: index('ai_conversation_search_message_idx').on(table.messageId),
    createdIdx: index('ai_conversation_search_created_idx').on(table.createdAt),
    normalizedIdx: index('ai_conversation_search_normalized_idx').on(table.normalizedText),
    ftsIdx: index('ai_conversation_search_fts_idx').using('gin', sql`to_tsvector('simple', ${table.normalizedText})`),
  })
);

export type AIConversationSearchDocument = typeof aiConversationSearchDocuments.$inferSelect;
export type NewAIConversationSearchDocument = typeof aiConversationSearchDocuments.$inferInsert;
