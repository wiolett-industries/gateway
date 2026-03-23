import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Basic regex that accepts IPv4, IPv6, and CIDR notation.
 *
 * Examples:
 *   192.168.1.0/24   10.0.0.1   ::1   2001:db8::/32   fe80::1
 */
const ipOrCidrRegex =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;

const IPRuleSchema = z.object({
  type: z.enum(['allow', 'deny']),
  value: z.string().min(1).regex(ipOrCidrRegex, 'Must be a valid IP address or CIDR notation'),
});

const BasicAuthUserInputSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateAccessListSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  ipRules: z.array(IPRuleSchema).default([]),
  basicAuthEnabled: z.boolean().default(false),
  basicAuthUsers: z.array(BasicAuthUserInputSchema).default([]),
});

// ---------------------------------------------------------------------------
// Update — partial version (all fields optional)
// ---------------------------------------------------------------------------

export const UpdateAccessListSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  ipRules: z.array(IPRuleSchema).optional(),
  basicAuthEnabled: z.boolean().optional(),
  basicAuthUsers: z.array(BasicAuthUserInputSchema).optional(),
});

// ---------------------------------------------------------------------------
// List query — pagination + search
// ---------------------------------------------------------------------------

export const AccessListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateAccessListInput = z.infer<typeof CreateAccessListSchema>;
export type UpdateAccessListInput = z.infer<typeof UpdateAccessListSchema>;
export type AccessListQuery = z.infer<typeof AccessListQuerySchema>;
