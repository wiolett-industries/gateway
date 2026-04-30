import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpAuthContext {
  server: McpServer;
  scopes: string[];
  tokenId: string;
  tokenPrefix: string;
  authType?: 'oauth' | 'api-token';
  clientId?: string;
}
