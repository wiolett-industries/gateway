import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(255);
const optionalTextSchema = z.string().trim().max(10_000).optional().nullable();
const tagsSchema = z.array(z.string().trim().min(1).max(64)).max(32).optional();

const postgresConnectionFields = z.object({
  connectionString: z.string().trim().min(1).max(4096).optional(),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().trim().min(1).max(255).optional(),
  username: z.string().trim().min(1).max(255).optional(),
  password: z.string().max(4096).optional(),
  sslEnabled: z.boolean().optional(),
});

const redisConnectionFields = z.object({
  connectionString: z.string().trim().min(1).max(4096).optional(),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).max(255).optional(),
  password: z.string().max(4096).optional(),
  db: z.number().int().min(0).max(15).optional(),
  tlsEnabled: z.boolean().optional(),
});

export const DatabaseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().optional(),
  type: z.enum(['postgres', 'redis']).optional(),
  healthStatus: z.enum(['online', 'offline', 'degraded', 'unknown']).optional(),
});

export const CreateDatabaseConnectionSchema = z.discriminatedUnion('type', [
  z.object({
    name: nameSchema,
    description: optionalTextSchema,
    tags: tagsSchema,
    manualSizeLimitMb: z.number().int().positive().max(1024 * 1024).optional().nullable(),
    type: z.literal('postgres'),
    config: postgresConnectionFields,
  }),
  z.object({
    name: nameSchema,
    description: optionalTextSchema,
    tags: tagsSchema,
    type: z.literal('redis'),
    config: redisConnectionFields,
  }),
]);

export const UpdateDatabaseConnectionSchema = z
  .object({
    name: nameSchema.optional(),
    description: optionalTextSchema,
    tags: tagsSchema,
    manualSizeLimitMb: z.number().int().positive().max(1024 * 1024).optional().nullable(),
    config: z
      .object({
        connectionString: z.string().trim().min(1).max(4096).optional(),
        host: z.string().trim().min(1).max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        database: z.string().trim().min(1).max(255).optional(),
        username: z.string().trim().min(1).max(255).optional(),
        password: z.string().max(4096).optional(),
        sslEnabled: z.boolean().optional(),
        db: z.number().int().min(0).max(15).optional(),
        tlsEnabled: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((data) => !!data.name || data.description !== undefined || !!data.tags || !!data.config, {
    message: 'At least one field must be provided',
  });

export const BrowsePostgresRowsQuerySchema = z.object({
  schema: z.string().trim().min(1).max(255),
  table: z.string().trim().min(1).max(255),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  sortBy: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const PostgresObjectSchema = z.record(z.string(), z.any());

export const ExecutePostgresSqlSchema = z.object({
  sql: z.string().trim().min(1).max(100_000),
});

export const RedisScanKeysQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  search: z.string().trim().optional(),
  type: z.string().trim().optional(),
});

export const RedisGetKeyQuerySchema = z.object({
  key: z.string().min(1).max(4096),
});

export const RedisSetKeySchema = z.object({
  key: z.string().min(1).max(4096),
  type: z.enum(['string', 'hash', 'list', 'set', 'zset']),
  ttlSeconds: z.number().int().min(-1).max(31_536_000).optional(),
  value: z.any(),
});

export const RedisExpireKeySchema = z.object({
  key: z.string().min(1).max(4096),
  ttlSeconds: z.number().int().min(-1).max(31_536_000),
});

export const ExecuteRedisCommandSchema = z.object({
  command: z.string().trim().min(1).max(10_000),
});

export type DatabaseListQuery = z.infer<typeof DatabaseListQuerySchema>;
export type CreateDatabaseConnectionInput = z.infer<typeof CreateDatabaseConnectionSchema>;
export type UpdateDatabaseConnectionInput = z.infer<typeof UpdateDatabaseConnectionSchema>;
