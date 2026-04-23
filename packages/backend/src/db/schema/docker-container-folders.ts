import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  uniqueIndex,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { nodes } from './nodes.js';
import { users } from './users.js';

export const dockerContainerFolders = pgTable(
  'docker_container_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => dockerContainerFolders.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    depth: integer('depth').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
    composeProject: varchar('compose_project', { length: 255 }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    parentIdx: index('docker_container_folder_parent_idx').on(table.parentId),
    sortIdx: index('docker_container_folder_sort_idx').on(table.parentId, table.sortOrder),
    systemComposeIdx: uniqueIndex('docker_container_folder_compose_unique_idx').on(table.nodeId, table.composeProject),
  })
);
