import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { dockerRegistries } from './docker-registries.js';
import { nodes } from './nodes.js';

export const dockerImageRegistryMappings = pgTable(
  'docker_image_registry_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    imageRepository: text('image_repository').notNull(),
    registryId: uuid('registry_id')
      .notNull()
      .references(() => dockerRegistries.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_image_registry_mappings_node_repo_unique').on(table.nodeId, table.imageRepository),
    index('docker_image_registry_mappings_registry_id_idx').on(table.registryId),
  ]
);
