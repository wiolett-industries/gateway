import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export type LoggingSchemaMode = 'loose' | 'strip' | 'reject';
export type LoggingFieldType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';
export type LoggingFieldLocation = 'label' | 'field';

export interface LoggingFieldDefinition {
  key: string;
  location: LoggingFieldLocation;
  type: LoggingFieldType;
  required: boolean;
  description?: string;
}

export const loggingSchemas = pgTable(
  'logging_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull().unique(),
    description: text('description'),
    schemaMode: varchar('schema_mode', { length: 20 }).$type<LoggingSchemaMode>().notNull().default('reject'),
    fieldSchema: jsonb('field_schema').$type<LoggingFieldDefinition[]>().notNull().default([]),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index('logging_schema_slug_idx').on(table.slug),
  })
);

export const loggingEnvironments = pgTable(
  'logging_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull().unique(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    schemaId: uuid('schema_id').references(() => loggingSchemas.id, { onDelete: 'set null' }),
    schemaMode: varchar('schema_mode', { length: 20 }).$type<LoggingSchemaMode>().notNull().default('reject'),
    retentionDays: integer('retention_days').notNull().default(30),
    rateLimitRequestsPerWindow: integer('rate_limit_requests_per_window'),
    rateLimitEventsPerWindow: integer('rate_limit_events_per_window'),
    fieldSchema: jsonb('field_schema').$type<LoggingFieldDefinition[]>().notNull().default([]),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index('logging_env_slug_idx').on(table.slug),
    enabledIdx: index('logging_env_enabled_idx').on(table.enabled),
    schemaIdx: index('logging_env_schema_idx').on(table.schemaId),
  })
);

export const loggingIngestTokens = pgTable(
  'logging_ingest_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => loggingEnvironments.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: varchar('token_prefix', { length: 20 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    envIdx: index('logging_token_env_idx').on(table.environmentId),
    hashIdx: index('logging_token_hash_idx').on(table.tokenHash),
  })
);
