import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { certificateAuthorities, keyAlgorithmEnum } from './certificate-authorities.js';
import { certificateTemplates } from './certificate-templates.js';
import { users } from './users.js';

export const certStatusEnum = pgEnum('cert_status', ['active', 'revoked', 'expired']);
export const certTypeEnum = pgEnum('cert_type', ['tls-server', 'tls-client', 'code-signing', 'email']);

export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caId: uuid('ca_id')
      .notNull()
      .references(() => certificateAuthorities.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id').references(() => certificateTemplates.id),
    status: certStatusEnum('status').notNull().default('active'),
    type: certTypeEnum('type').notNull(),

    // Subject
    commonName: varchar('common_name', { length: 255 }).notNull(),
    sans: jsonb('sans').$type<string[]>().default([]),

    // Certificate data
    serialNumber: varchar('serial_number', { length: 255 }).notNull(),
    certificatePem: text('certificate_pem').notNull(),

    // Private key — NULL when issued via CSR upload
    encryptedPrivateKey: text('encrypted_private_key'),
    encryptedDek: text('encrypted_dek'),
    dekIv: text('dek_iv'),

    keyAlgorithm: keyAlgorithmEnum('key_algorithm').notNull(),
    subjectDn: text('subject_dn').notNull(),
    issuerDn: text('issuer_dn').notNull(),

    // Validity
    notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
    notAfter: timestamp('not_after', { withTimezone: true }).notNull(),

    // CSR tracking
    csrPem: text('csr_pem'),
    serverGenerated: boolean('server_generated').notNull().default(false),

    // Extensions stored for display
    keyUsage: jsonb('key_usage').$type<string[]>().default([]),
    extKeyUsage: jsonb('ext_key_usage').$type<string[]>().default([]),

    // Revocation
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: varchar('revocation_reason', { length: 50 }),

    // Metadata
    issuedById: uuid('issued_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caIdx: index('cert_ca_idx').on(table.caId),
    statusIdx: index('cert_status_idx').on(table.status),
    serialIdx: uniqueIndex('cert_serial_idx').on(table.serialNumber),
    cnIdx: index('cert_cn_idx').on(table.commonName),
    typeIdx: index('cert_type_idx').on(table.type),
    notAfterIdx: index('cert_not_after_idx').on(table.notAfter),
    issuedByIdx: index('cert_issued_by_idx').on(table.issuedById),
  })
);
