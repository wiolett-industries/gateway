import { describe, expect, it } from 'vitest';
import { getOpenAITools } from './ai.tools.js';

function toolNames(scopes: string[]): string[] {
  return getOpenAITools([], scopes, false).map((tool) => tool.function.name);
}

describe('AI tool scope filtering', () => {
  it('requires direct database view before advertising database query tools', () => {
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-2'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('query_postgres_read');
  });
});
