import { pgTable, uuid, varchar, integer, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const proxyHostFolders = pgTable('proxy_host_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => proxyHostFolders.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  depth: integer('depth').notNull().default(0), // denormalized: 0=root, 1=child, 2=grandchild
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  parentIdx: index('proxy_host_folder_parent_idx').on(table.parentId),
  sortIdx: index('proxy_host_folder_sort_idx').on(table.parentId, table.sortOrder),
}));
