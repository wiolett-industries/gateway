import { z } from 'zod';
import { LOGGING_SEVERITIES } from './logging-storage.types.js';

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);

export const LoggingFieldDefinitionSchema = z
  .object({
    key: keySchema,
    location: z.enum(['label', 'field']),
    type: z.enum(['string', 'number', 'boolean', 'datetime', 'json']),
    required: z.boolean().default(false),
    description: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.location === 'label' && value.type !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'Label definitions must use string type',
      });
    }
  });

const fieldSchemaArray = z
  .array(LoggingFieldDefinitionSchema)
  .max(128)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const [index, field] of fields.entries()) {
      const key = `${field.location}:${field.key}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'key'],
          message: 'Field keys must be unique per location',
        });
      }
      seen.add(key);
    }
  });

export const CreateLoggingEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(10_000).optional().nullable(),
  enabled: z.boolean().default(true),
  schemaId: z.string().uuid().nullable().optional(),
  schemaMode: z.enum(['loose', 'strip', 'reject']).default('reject'),
  retentionDays: z.number().int().min(1).max(365).default(30),
  rateLimitRequestsPerWindow: z.number().int().positive().nullable().optional(),
  rateLimitEventsPerWindow: z.number().int().positive().nullable().optional(),
  fieldSchema: fieldSchemaArray.default([]),
});

export const UpdateLoggingEnvironmentSchema = CreateLoggingEnvironmentSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided' }
);

export const CreateLoggingSchemaSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(10_000).optional().nullable(),
  schemaMode: z.enum(['loose', 'strip', 'reject']).default('reject'),
  fieldSchema: fieldSchemaArray.default([]),
});

export const UpdateLoggingSchemaSchema = CreateLoggingSchemaSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided' }
);

export const CreateLoggingTokenSchema = z.object({
  name: z.string().trim().min(1).max(255),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const LoggingEventSchema = z.object({
  timestamp: z.string().datetime().optional(),
  severity: z.enum(LOGGING_SEVERITIES as [string, ...string[]]),
  message: z.string(),
  service: z.string().optional(),
  source: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  requestId: z.string().optional(),
  labels: z.record(z.unknown()).optional(),
  fields: z.record(z.unknown()).optional(),
});

export const LoggingBatchSchema = z.object({
  logs: z.array(z.unknown()),
});

const fieldFilterSchema = z.object({
  op: z.enum(['eq', 'contains', 'gt', 'gte', 'lt', 'lte']),
  value: z.unknown(),
});

export const LoggingSearchSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  severities: z
    .array(z.enum(LOGGING_SEVERITIES as [string, ...string[]]))
    .max(6)
    .optional(),
  services: z.array(z.string().trim().max(255)).max(50).optional(),
  sources: z.array(z.string().trim().max(255)).max(50).optional(),
  message: z.string().trim().max(1000).optional(),
  traceId: z.string().trim().max(255).optional(),
  spanId: z.string().trim().max(255).optional(),
  requestId: z.string().trim().max(255).optional(),
  labels: z.record(z.string().trim().max(8192)).optional(),
  fields: z.record(fieldFilterSchema).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().nullable().optional(),
});

export const LoggingFacetsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type CreateLoggingEnvironmentInput = z.infer<typeof CreateLoggingEnvironmentSchema>;
export type UpdateLoggingEnvironmentInput = z.infer<typeof UpdateLoggingEnvironmentSchema>;
export type CreateLoggingSchemaInput = z.infer<typeof CreateLoggingSchemaSchema>;
export type UpdateLoggingSchemaInput = z.infer<typeof UpdateLoggingSchemaSchema>;
export type CreateLoggingTokenInput = z.infer<typeof CreateLoggingTokenSchema>;
