import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';

export interface DockerRuntimeSettingsConfig {
  restartPolicy?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  maxRetries?: number;
  memoryLimit?: number;
  memorySwap?: number;
  nanoCPUs?: number;
  cpuShares?: number;
  pidsLimit?: number;
}

export const dockerRuntimeSettings = pgTable(
  'docker_runtime_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    containerName: text('container_name').notNull(),
    config: jsonb('config').$type<DockerRuntimeSettingsConfig>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_runtime_settings_unique').on(table.nodeId, table.containerName),
    index('docker_runtime_settings_container_idx').on(table.nodeId, table.containerName),
  ]
);
