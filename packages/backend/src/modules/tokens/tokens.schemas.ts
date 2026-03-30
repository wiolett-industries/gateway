import { z } from 'zod';

export const AVAILABLE_SCOPES = [
  'ca:read',
  'ca:create:root',
  'ca:create:intermediate',
  'ca:revoke',
  'cert:read',
  'cert:issue',
  'cert:revoke',
  'cert:export',
  'template:read',
  'template:manage',
  'admin:users',
  'admin:audit',
] as const;

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.enum(AVAILABLE_SCOPES)).min(1, 'At least one scope is required'),
});

export const TokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const CreateTokenResponseSchema = TokenResponseSchema.extend({
  token: z.string(),
});

export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;
