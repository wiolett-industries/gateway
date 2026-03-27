import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { certTypeEnum } from './certificates.js';
import { keyAlgorithmEnum } from './certificate-authorities.js';
import { users } from './users.js';

export const certificateTemplates = pgTable('certificate_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isBuiltin: boolean('is_builtin').notNull().default(false),

  // Template configuration
  certType: certTypeEnum('cert_type').notNull(),
  keyAlgorithm: keyAlgorithmEnum('key_algorithm').notNull().default('ecdsa-p256'),
  validityDays: integer('validity_days').notNull().default(365),
  keyUsage: jsonb('key_usage').$type<string[]>().notNull(),
  extKeyUsage: jsonb('ext_key_usage').$type<string[]>().notNull(),

  // Subject constraints
  requireSans: boolean('require_sans').notNull().default(true),
  sanTypes: jsonb('san_types').$type<string[]>().default(['dns', 'ip']),

  // Metadata
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
