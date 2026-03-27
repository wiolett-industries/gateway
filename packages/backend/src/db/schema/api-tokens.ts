import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const apiTokenPermissionEnum = pgEnum('api_token_permission', ['read', 'read-write']);

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: varchar('token_prefix', { length: 20 }).notNull(),
  permission: apiTokenPermissionEnum('permission').notNull().default('read-write'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('api_tokens_user_idx').on(table.userId),
  tokenHashIdx: index('api_tokens_token_hash_idx').on(table.tokenHash),
}));

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
