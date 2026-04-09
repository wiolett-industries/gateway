import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';

export const dockerTasks = pgTable('docker_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  containerId: text('container_id'),
  containerName: text('container_name'),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  progress: text('progress'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
