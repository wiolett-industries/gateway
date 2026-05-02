import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';

export const dockerRegistries = pgTable('docker_registries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  username: text('username'),
  encryptedPassword: text('encrypted_password'),
  trustedAuthRealm: text('trusted_auth_realm'),
  scope: text('scope').notNull().default('global'),
  nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
