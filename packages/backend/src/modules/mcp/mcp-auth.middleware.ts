import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { container } from '@/container.js';
import { hasScope } from '@/lib/permissions.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

export const mcpAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('Cookie')) {
    throw new HTTPException(401, { message: 'MCP requires a Gateway API token; cookies are not accepted' });
  }

  const token = bearerToken(c.req.header('Authorization'));
  if (!token) {
    throw new HTTPException(401, { message: 'MCP requires Authorization: Bearer gw_...' });
  }
  if (token.startsWith('gwl_')) {
    throw new HTTPException(401, { message: 'Logging ingest tokens cannot access MCP' });
  }
  if (!token.startsWith('gw_')) {
    throw new HTTPException(401, { message: 'Invalid MCP API token' });
  }

  const tokensService = container.resolve(TokensService);
  const result = await tokensService.validateToken(token);
  if (!result) {
    throw new HTTPException(401, { message: 'Invalid or expired API token' });
  }
  if (result.scopes.length === 0) {
    throw new HTTPException(403, { message: 'MCP requires at least one effective API token scope' });
  }
  if (!hasScope(result.scopes, 'mcp:use')) {
    throw new HTTPException(403, { message: 'MCP requires the mcp:use scope' });
  }

  c.set('user', result.user);
  c.set('effectiveScopes', result.scopes);
  c.set('isTokenAuth', true);
  c.set('mcpAuth', { tokenId: result.tokenId, tokenPrefix: result.tokenPrefix });

  await next();
};
