import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const notificationWebhooks = pgTable(
  'notification_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    url: text('url').notNull(),
    method: varchar('method', { length: 10 }).notNull().default('POST'), // GET, POST, PUT, PATCH
    enabled: boolean('enabled').notNull().default(true),

    // Authentication
    signingSecret: text('signing_secret'), // HMAC-SHA256 secret (encrypted)
    signingHeader: varchar('signing_header', { length: 100 }).default('X-Signature-256'),

    // Template — wraps the alert's {{message}} into the service-specific format
    templatePreset: varchar('template_preset', { length: 50 }), // 'discord' | 'slack' | 'telegram' | 'json' | 'plain' | null
    bodyTemplate: text('body_template'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    enabledIdx: index('notif_webhooks_enabled_idx').on(table.enabled),
  })
);
