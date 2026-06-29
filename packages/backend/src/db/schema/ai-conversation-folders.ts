import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const aiConversationFolders = pgTable(
  'ai_conversation_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userSortIdx: index('ai_conversation_folders_user_sort_idx').on(table.userId, table.sortOrder),
    userNameIdx: index('ai_conversation_folders_user_name_idx').on(table.userId, table.name),
  })
);

export type AIConversationFolder = typeof aiConversationFolders.$inferSelect;
export type NewAIConversationFolder = typeof aiConversationFolders.$inferInsert;
