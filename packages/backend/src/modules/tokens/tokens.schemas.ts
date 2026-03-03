import { z } from 'zod';

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(255),
  permission: z.enum(['read', 'read-write']).default('read-write'),
});

export const TokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  permission: z.enum(['read', 'read-write']),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const CreateTokenResponseSchema = TokenResponseSchema.extend({
  token: z.string(),
});

export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;
