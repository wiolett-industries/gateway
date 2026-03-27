import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Granular API token scopes:
 *   ca:read                    — view all CAs
 *   ca:create:root             — create root CAs
 *   ca:create:intermediate     — create intermediates under any CA
 *   ca:create:intermediate:<id>— create intermediates under specific CA only
 *   ca:revoke                  — revoke any CA
 *   cert:read                  — view all certificates
 *   cert:issue                 — issue certs from any CA
 *   cert:issue:<id>            — issue certs only from specific CA
 *   cert:revoke                — revoke any certificate
 *   cert:export                — export certs (PEM/DER/PKCS12/JKS)
 *   template:read              — view templates
 *   template:manage            — create/edit/delete templates
 *   admin:users                — manage user roles
 *   admin:audit                — view audit log
 */

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: varchar('token_prefix', { length: 20 }).notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('api_tokens_user_idx').on(table.userId),
  tokenHashIdx: index('api_tokens_token_hash_idx').on(table.tokenHash),
}));

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
