import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const dnsStatusEnum = pgEnum('dns_status', ['valid', 'invalid', 'pending', 'unknown']);

export interface DnsRecords {
  a: string[];
  aaaa: string[];
  cname: string[];
  caa: Array<{ critical: number; issue?: string; issuewild?: string }>;
  mx: Array<{ exchange: string; priority: number }>;
  txt: string[][];
}

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domain: varchar('domain', { length: 253 }).notNull().unique(),
    description: text('description'),
    dnsStatus: dnsStatusEnum('dns_status').notNull().default('pending'),
    lastDnsCheckAt: timestamp('last_dns_check_at', { withTimezone: true }),
    dnsRecords: jsonb('dns_records').$type<DnsRecords>(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('domain_domain_idx').on(table.domain),
    index('domain_dns_status_idx').on(table.dnsStatus),
    index('domain_created_by_idx').on(table.createdById),
  ]
);
