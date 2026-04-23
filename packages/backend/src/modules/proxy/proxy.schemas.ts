import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const domainNameRegex = /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const DomainNameSchema = z.string().min(1).max(253).regex(domainNameRegex, 'Invalid domain name format');

const CustomHeaderSchema = z.object({
  name: z.string().min(1).max(255),
  value: z.string().min(1).max(4096),
});

const CacheOptionsSchema = z.object({
  maxAge: z.number().int().min(0).optional(),
  staleWhileRevalidate: z.number().int().min(0).optional(),
});

const RateLimitOptionsSchema = z.object({
  requestsPerSecond: z.number().int().min(1),
  burst: z.number().int().min(1).optional(),
});

const RewriteRuleSchema = z.object({
  source: z.string().min(1).max(1024),
  destination: z.string().min(1).max(1024),
  type: z.enum(['permanent', 'temporary']),
});

const HealthCheckBodyMatchModeSchema = z.enum(['includes', 'exact', 'starts_with', 'ends_with']);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateProxyHostSchema = z
  .object({
    type: z.enum(['proxy', 'redirect', '404', 'raw']).default('proxy'),
    nodeId: z.string().uuid('A node must be selected'),
    domainNames: z.array(DomainNameSchema).min(1, 'At least one domain name is required'),

    // Upstream — proxy type
    forwardHost: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Invalid hostname')
      .optional(),
    forwardPort: z.number().int().min(1).max(65535).optional(),
    forwardScheme: z.enum(['http', 'https']).default('http'),

    // SSL
    sslEnabled: z.boolean().default(false),
    sslForced: z.boolean().default(false),
    http2Support: z.boolean().default(true),
    websocketSupport: z.boolean().default(false),
    sslCertificateId: z.string().uuid().optional(),
    internalCertificateId: z.string().uuid().optional(),

    // Redirect type
    redirectUrl: z.string().url().max(2048).optional(),
    redirectStatusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),

    // Custom headers
    customHeaders: z.array(CustomHeaderSchema).default([]),

    // Cache
    cacheEnabled: z.boolean().default(false),
    cacheOptions: CacheOptionsSchema.optional(),

    // Rate limit
    rateLimitEnabled: z.boolean().default(false),
    rateLimitOptions: RateLimitOptionsSchema.optional(),

    // Rewrites
    customRewrites: z.array(RewriteRuleSchema).default([]),

    // Advanced nginx config
    advancedConfig: z.string().max(10000).optional(),

    // Raw config override — bypasses template rendering
    rawConfig: z.string().max(100000).optional(),
    rawConfigEnabled: z.boolean().optional(),

    // Access list
    accessListId: z.string().uuid().optional(),

    // Folder
    folderId: z.string().uuid().optional(),

    // Nginx config template
    nginxTemplateId: z.string().uuid().optional(),
    templateVariables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),

    // Health check
    healthCheckEnabled: z.boolean().default(false),
    healthCheckUrl: z.string().max(500).regex(/^\//, 'Must start with /').optional(),
    healthCheckInterval: z.number().int().min(5).max(3600).optional(),
    healthCheckExpectedStatus: z.number().int().min(100).max(599).optional(),
    healthCheckExpectedBody: z.string().max(500).optional(),
    healthCheckBodyMatchMode: HealthCheckBodyMatchModeSchema.optional(),
    healthCheckSlowThreshold: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'proxy') {
      if (!data.forwardHost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'forwardHost is required for proxy type',
          path: ['forwardHost'],
        });
      }
      if (data.forwardPort === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'forwardPort is required for proxy type',
          path: ['forwardPort'],
        });
      }
    }

    if (data.type === 'redirect') {
      if (!data.redirectUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'redirectUrl is required for redirect type',
          path: ['redirectUrl'],
        });
      }
    }

    if (data.type === '404' && data.healthCheckEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Health checks are not available for 404 hosts (no upstream)',
        path: ['healthCheckEnabled'],
      });
    }
  });

// ---------------------------------------------------------------------------
// Update — partial version (all fields optional)
// ---------------------------------------------------------------------------

export const UpdateProxyHostSchema = z.object({
  type: z.enum(['proxy', 'redirect', '404', 'raw']).optional(),
  domainNames: z.array(DomainNameSchema).min(1, 'At least one domain name is required').optional(),

  forwardHost: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Invalid hostname')
    .optional()
    .nullable(),
  forwardPort: z.number().int().min(1).max(65535).optional().nullable(),
  forwardScheme: z.enum(['http', 'https']).optional(),

  sslEnabled: z.boolean().optional(),
  sslForced: z.boolean().optional(),
  http2Support: z.boolean().optional(),
  websocketSupport: z.boolean().optional(),
  sslCertificateId: z.string().uuid().optional().nullable(),
  internalCertificateId: z.string().uuid().optional().nullable(),

  redirectUrl: z.string().url().max(2048).optional().nullable(),
  redirectStatusCode: z
    .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
    .optional()
    .nullable(),

  customHeaders: z.array(CustomHeaderSchema).optional(),
  cacheEnabled: z.boolean().optional(),
  cacheOptions: CacheOptionsSchema.optional().nullable(),
  rateLimitEnabled: z.boolean().optional(),
  rateLimitOptions: RateLimitOptionsSchema.optional().nullable(),
  customRewrites: z.array(RewriteRuleSchema).optional(),

  advancedConfig: z.string().max(10000).optional().nullable(),

  rawConfig: z.string().max(100000).optional().nullable(),
  rawConfigEnabled: z.boolean().optional(),

  accessListId: z.string().uuid().optional().nullable(),

  folderId: z.string().uuid().optional().nullable(),

  nginxTemplateId: z.string().uuid().optional().nullable(),
  templateVariables: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .nullable(),

  healthCheckEnabled: z.boolean().optional(),
  healthCheckUrl: z.string().max(500).regex(/^\//, 'Must start with /').optional().nullable(),
  healthCheckInterval: z.number().int().min(5).max(3600).optional().nullable(),
  healthCheckExpectedStatus: z.number().int().min(100).max(599).optional().nullable(),
  healthCheckExpectedBody: z.string().max(500).optional().nullable(),
  healthCheckBodyMatchMode: HealthCheckBodyMatchModeSchema.optional().nullable(),
  healthCheckSlowThreshold: z.number().int().min(0).max(100).optional().nullable(),
});

// ---------------------------------------------------------------------------
// List query — pagination + filters
// ---------------------------------------------------------------------------

export const ProxyHostListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['proxy', 'redirect', '404', 'raw']).optional(),
  enabled: z.coerce.boolean().optional(),
  healthStatus: z.enum(['online', 'offline', 'degraded', 'unknown']).optional(),
  search: z.string().max(255).optional(),
  nodeId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Toggle enabled/disabled
// ---------------------------------------------------------------------------

export const ToggleProxyHostSchema = z.object({
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// Validate advanced config
// ---------------------------------------------------------------------------

export const ValidateAdvancedConfigSchema = z.object({
  snippet: z.string().min(1).max(100000),
  mode: z.enum(['advanced', 'raw']).optional().default('advanced'),
  proxyHostId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateProxyHostInput = z.infer<typeof CreateProxyHostSchema>;
export type UpdateProxyHostInput = z.infer<typeof UpdateProxyHostSchema>;
export type ProxyHostListQuery = z.infer<typeof ProxyHostListQuerySchema>;
export type ToggleProxyHostInput = z.infer<typeof ToggleProxyHostSchema>;
export type ValidateAdvancedConfigInput = z.infer<typeof ValidateAdvancedConfigSchema>;
