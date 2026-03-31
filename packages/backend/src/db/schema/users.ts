import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { permissionGroups } from './permission-groups.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcSubject: varchar('oidc_subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    avatarUrl: text('avatar_url'),
    groupId: uuid('group_id')
      .notNull()
      .references(() => permissionGroups.id),
    isBlocked: boolean('is_blocked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    oidcSubjectIdx: uniqueIndex('users_oidc_subject_idx').on(table.oidcSubject),
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    groupIdx: index('users_group_id_idx').on(table.groupId),
  })
);
