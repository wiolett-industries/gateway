import { z } from '@hono/zod-openapi';
import { appRoute, createdJson, IdParamSchema, jsonBody, okJson } from '@/lib/openapi.js';
import { CreateTokenResponseSchema, CreateTokenSchema, TokenResponseSchema } from './tokens.schemas.js';

const RenameTokenSchema = z.object({
  name: z.string().min(1).max(255),
});

export const listTokensRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Tokens'],
  summary: 'List API tokens',
  responses: okJson(z.array(TokenResponseSchema)),
});

export const createTokenRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Tokens'],
  summary: 'Create an API token',
  request: jsonBody(CreateTokenSchema),
  responses: createdJson(CreateTokenResponseSchema),
});

export const renameTokenRoute = appRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Tokens'],
  summary: 'Rename an API token',
  request: { params: IdParamSchema, ...jsonBody(RenameTokenSchema) },
  responses: okJson(z.object({ success: z.boolean() })),
});

export const revokeTokenRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tokens'],
  summary: 'Revoke an API token',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});
