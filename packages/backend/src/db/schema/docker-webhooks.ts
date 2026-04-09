import { boolean, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';

export const dockerWebhooks = pgTable(
  'docker_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    containerName: text('container_name').notNull(),
    token: uuid('token').notNull().defaultRandom(),
    enabled: boolean('enabled').notNull().default(true),
    cleanupEnabled: boolean('cleanup_enabled').notNull().default(false),
    retentionCount: integer('retention_count').notNull().default(2),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_webhooks_node_id_container_name_unique').on(table.nodeId, table.containerName),
    uniqueIndex('docker_webhooks_token_idx').on(table.token),
  ]
);
