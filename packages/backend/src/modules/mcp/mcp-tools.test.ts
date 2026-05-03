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
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:write:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:admin:db-1'])).toContain('execute_postgres_sql');
  });

  it('does not advertise rendered proxy config reads through raw write implication', () => {
    expect(toolNames(['proxy:raw:write:proxy-1'])).not.toContain('get_proxy_rendered_config');
    expect(toolNames(['proxy:raw:read:proxy-1'])).toContain('get_proxy_rendered_config');
  });
});
