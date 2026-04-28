import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { container } from '@/container.js';
import type { AppEnv } from '@/types.js';
import { mcpAuthMiddleware } from './mcp-auth.middleware.js';
import { createMcpServer } from './mcp-server.factory.js';
import { McpSettingsService } from './mcp-settings.service.js';

export const mcpRoutes = new Hono<AppEnv>();

function methodNotAllowed() {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: 'Method not allowed for stateless MCP; use POST',
      },
    }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

mcpRoutes.use('*', async (_c, next) => {
  const enabled = await container.resolve(McpSettingsService).isEnabled();
  if (!enabled) {
    throw new HTTPException(404, { message: 'MCP server is disabled' });
  }
  await next();
});

mcpRoutes.use('*', mcpAuthMiddleware);

mcpRoutes.post('/', async (c) => {
  const user = c.get('user');
  const scopes = c.get('effectiveScopes');
  const auth = c.get('mcpAuth');
  if (!user || !scopes || !auth) {
    return c.json({ message: 'MCP authentication context missing' }, 500);
  }

  const { server, transport } = createMcpServer({
    user,
    scopes,
    tokenId: auth.tokenId,
    tokenPrefix: auth.tokenPrefix,
  });

  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

mcpRoutes.get('/', () => methodNotAllowed());
mcpRoutes.delete('/', () => methodNotAllowed());
