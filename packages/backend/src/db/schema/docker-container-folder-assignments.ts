import { index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { dockerContainerFolders } from './docker-container-folders.js';
import { nodes } from './nodes.js';

export const dockerContainerFolderAssignments = pgTable(
  'docker_container_folder_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    containerName: varchar('container_name', { length: 255 }).notNull(),
    folderId: uuid('folder_id').references(() => dockerContainerFolders.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nodeNameIdx: uniqueIndex('docker_container_folder_assignment_node_name_idx').on(
      table.nodeId,
      table.containerName
    ),
    folderIdx: index('docker_container_folder_assignment_folder_idx').on(table.folderId, table.sortOrder),
  })
);
