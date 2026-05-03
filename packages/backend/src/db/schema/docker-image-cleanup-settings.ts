import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { dockerDeployments } from './docker-deployments.js';
import { nodes } from './nodes.js';

export const dockerImageCleanupSettings = pgTable(
  'docker_image_cleanup_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<'container' | 'deployment'>().notNull().default('container'),
    containerName: text('container_name'),
    deploymentId: uuid('deployment_id').references(() => dockerDeployments.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    retentionCount: integer('retention_count').notNull().default(2),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('docker_image_cleanup_container_unique').on(table.nodeId, table.targetType, table.containerName),
    uniqueIndex('docker_image_cleanup_deployment_unique').on(table.deploymentId),
  ]
);
