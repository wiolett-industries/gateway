import { z } from 'zod';
import { API_TOKEN_SCOPES, isApiTokenScope, isValidBaseScope } from '@/lib/scopes.js';

export const AVAILABLE_SCOPES = API_TOKEN_SCOPES;

const TokenScopeArraySchema = z
  .array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(:[a-zA-Z0-9-]+)*$/, 'Invalid scope format'))
  .min(1, 'At least one scope is required')
  .refine((scopes) => scopes.every(isValidBaseScope), 'One or more scopes have an unrecognized base scope')
  .refine((scopes) => scopes.every(isApiTokenScope), 'One or more scopes cannot be granted to API tokens');

export const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(255),
  scopes: TokenScopeArraySchema,
});

export const UpdateTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    scopes: TokenScopeArraySchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.scopes !== undefined, 'At least one field is required');

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
export type UpdateTokenInput = z.infer<typeof UpdateTokenSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;
