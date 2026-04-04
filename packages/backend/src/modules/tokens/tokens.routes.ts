import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { isScopeSubset } from '@/lib/permissions.js';
import { authMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { CreateTokenSchema } from './tokens.schemas.js';
import { TokensService } from './tokens.service.js';

export const tokensRoutes = new OpenAPIHono<AppEnv>();

tokensRoutes.use('*', authMiddleware);
tokensRoutes.use('*', sessionOnly);

tokensRoutes.get('/', async (c) => {
  const tokensService = container.resolve(TokensService);
  const user = c.get('user')!;
  const tokens = await tokensService.listTokens(user.id);
  return c.json(tokens);
});

tokensRoutes.post('/', async (c) => {
  const tokensService = container.resolve(TokensService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateTokenSchema.parse(body);

  // Token scopes must be a subset of the user's group scopes
  const userScopes = user.scopes;
  if (!isScopeSubset(input.scopes, userScopes)) {
    const disallowed = input.scopes.filter((s) => !TokensService.hasScope(userScopes, s));
    return c.json(
      { code: 'SCOPE_NOT_ALLOWED', message: `Your group cannot grant scopes: ${disallowed.join(', ')}` },
      403
    );
  }

  const result = await tokensService.createToken(user.id, input);
  return c.json(result, 201);
});

tokensRoutes.patch('/:id', async (c) => {
  const tokensService = container.resolve(TokensService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const { name } = await c.req.json();
  if (!name?.trim()) return c.json({ code: 'INVALID', message: 'Name is required' }, 400);
  await tokensService.renameToken(user.id, id, name.trim());
  return c.json({ success: true });
});

tokensRoutes.delete('/:id', async (c) => {
  const tokensService = container.resolve(TokensService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await tokensService.revokeToken(user.id, id);
  return c.body(null, 204);
});
