import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { certificates } from './certificates.js';
import { users } from './users.js';

export const sslCertTypeEnum = pgEnum('ssl_cert_type', ['acme', 'upload', 'internal']);
export const sslCertStatusEnum = pgEnum('ssl_cert_status', ['active', 'expired', 'pending', 'error']);
export const acmeChallengeEnum = pgEnum('acme_challenge_type', ['http-01', 'dns-01']);

export const sslCertificates = pgTable(
  'ssl_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    type: sslCertTypeEnum('type').notNull(),
    domainNames: jsonb('domain_names').$type<string[]>().notNull().default([]),

    // Certificate data
    certificatePem: text('certificate_pem'),
    privateKeyPem: text('private_key_pem'), // encrypted via envelope encryption
    encryptedDek: text('encrypted_dek'),
    dekIv: text('dek_iv'),
    chainPem: text('chain_pem'),

    // ACME specific
    acmeProvider: varchar('acme_provider', { length: 50 }), // 'letsencrypt', 'letsencrypt-staging'
    acmeChallengeType: acmeChallengeEnum('acme_challenge_type'),
    acmeAccountKey: text('acme_account_key'), // encrypted
    acmeOrderUrl: text('acme_order_url'),

    // Internal CA link — references existing PKI cert
    internalCertId: uuid('internal_cert_id').references(() => certificates.id, { onDelete: 'set null' }),

    // Validity
    notBefore: timestamp('not_before', { withTimezone: true }),
    notAfter: timestamp('not_after', { withTimezone: true }),
    autoRenew: boolean('auto_renew').notNull().default(false),
    lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }),
    renewalError: text('renewal_error'),

    // Status
    status: sslCertStatusEnum('status').notNull().default('pending'),

    // Metadata
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('ssl_cert_status_idx').on(table.status),
    notAfterIdx: index('ssl_cert_not_after_idx').on(table.notAfter),
    typeIdx: index('ssl_cert_type_idx').on(table.type),
    createdByIdx: index('ssl_cert_created_by_idx').on(table.createdById),
  })
);
