import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';

export const dockerEnvVars = pgTable(
  'docker_env_vars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    containerName: text('container_name').notNull(),
    key: text('key').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_env_var_unique').on(table.nodeId, table.containerName, table.key),
    index('docker_env_var_container_idx').on(table.nodeId, table.containerName),
  ]
);
