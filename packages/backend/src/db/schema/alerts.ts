import { pgTable, uuid, varchar, text, timestamp, boolean, index, pgEnum } from 'drizzle-orm/pg-core';

export const alertTypeEnum = pgEnum('alert_type', ['expiry_warning', 'expiry_critical', 'ca_expiry', 'revocation']);

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: alertTypeEnum('type').notNull(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  message: text('message').notNull(),
  dismissed: boolean('dismissed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resourceIdx: index('alert_resource_idx').on(table.resourceType, table.resourceId),
  dismissedIdx: index('alert_dismissed_idx').on(table.dismissed),
  typeIdx: index('alert_type_idx').on(table.type),
}));
