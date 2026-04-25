import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const databaseTypeEnum = pgEnum('database_type', ['postgres', 'redis']);
export const databaseHealthStatusEnum = pgEnum('database_health_status', ['online', 'offline', 'degraded', 'unknown']);

export interface DatabaseHealthEntry {
  ts: string;
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  responseMs?: number;
  slow?: boolean;
}

export const databaseConnections = pgTable(
  'database_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    type: databaseTypeEnum('type').notNull(),
    description: text('description'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    databaseName: varchar('database_name', { length: 255 }),
    username: varchar('username', { length: 255 }),
    tlsEnabled: boolean('tls_enabled').notNull().default(false),
    manualSizeLimitMb: integer('manual_size_limit_mb'),
    encryptedConfig: text('encrypted_config').notNull(),
    healthStatus: databaseHealthStatusEnum('health_status').notNull().default('unknown'),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    lastError: text('last_error'),
    healthHistory: jsonb('health_history').$type<DatabaseHealthEntry[]>().notNull().default([]),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index('database_connections_type_idx').on(table.type),
    healthIdx: index('database_connections_health_idx').on(table.healthStatus),
    createdByIdx: index('database_connections_created_by_idx').on(table.createdById),
    updatedByIdx: index('database_connections_updated_by_idx').on(table.updatedById),
  })
);
