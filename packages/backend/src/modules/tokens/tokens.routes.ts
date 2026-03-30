import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
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
  const result = await tokensService.createToken(user.id, input);
  return c.json(result, 201);
});

tokensRoutes.delete('/:id', async (c) => {
  const tokensService = container.resolve(TokensService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await tokensService.revokeToken(user.id, id);
  return c.body(null, 204);
});
