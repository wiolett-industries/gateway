import { describe, expect, it } from 'vitest';
import { listAvailableMcpTools } from './mcp-tools.js';

function toolNames(scopes: string[]): string[] {
  return listAvailableMcpTools(scopes).map((tool) => tool.name);
}

describe('MCP tool scope filtering', () => {
  it('requires direct database view before advertising database query tools', () => {
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-2'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('query_postgres_read');
  });
});
