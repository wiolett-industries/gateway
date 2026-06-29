import { type AnyPgColumn, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const databaseConnectionFolders = pgTable(
  'database_connection_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => databaseConnectionFolders.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    depth: integer('depth').notNull().default(0),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    parentIdx: index('database_connection_folder_parent_idx').on(table.parentId),
    sortIdx: index('database_connection_folder_sort_idx').on(table.parentId, table.sortOrder),
  })
);
