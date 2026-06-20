import { describe, expect, it } from 'vitest';
import { AI_TOOLS, getOpenAITools, isDestructiveTool } from './ai.tools.js';

function toolNames(scopes: string[]): string[] {
  return getOpenAITools([], scopes, false).map((tool) => tool.function.name);
}

function notificationToolNamesForScopes(scopes: string[]): string[] {
  const notificationToolNames = new Set(
    AI_TOOLS.filter((tool) => tool.category === 'Notifications').map((tool) => tool.name)
  );
  return toolNames(scopes).filter((name) => notificationToolNames.has(name));
}

describe('AI tool scope filtering', () => {
  it('requires direct database view before advertising database query tools', () => {
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-2'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:write:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:admin:db-1'])).toContain('execute_postgres_sql');
  });

  it('keeps notification and web-search tool registry contracts stable', () => {
    const notificationToolNames = AI_TOOLS.filter((tool) => tool.category === 'Notifications').map((tool) => tool.name);

    expect(notificationToolNames).toEqual([
      'list_alert_rules',
      'get_alert_rule',
      'create_alert_rule',
      'update_alert_rule',
      'delete_alert_rule',
      'list_webhooks',
      'create_webhook',
      'update_webhook',
      'delete_webhook',
      'test_webhook',
      'list_webhook_deliveries',
      'get_delivery_stats',
    ]);
    expect(notificationToolNamesForScopes(['notifications:view'])).toEqual([
      'list_alert_rules',
      'get_alert_rule',
      'list_webhooks',
      'list_webhook_deliveries',
      'get_delivery_stats',
    ]);
    expect(notificationToolNamesForScopes(['notifications:manage'])).toEqual(notificationToolNames);
    expect(isDestructiveTool('create_alert_rule')).toBe(true);
    expect(isDestructiveTool('test_webhook')).toBe(false);

    expect(toolNames(['feat:ai:use'])).not.toContain('web_search');
    expect(getOpenAITools([], ['feat:ai:use'], true).map((tool) => tool.function.name)).toContain('web_search');
  });

  it('keeps logging and status-page tool registry contracts stable', () => {
    expect(AI_TOOLS.filter((tool) => tool.category === 'Logging').map((tool) => tool.name)).toEqual(['manage_logging']);
    expect(AI_TOOLS.filter((tool) => tool.category === 'Status Page').map((tool) => tool.name)).toEqual([
      'manage_status_page',
    ]);

    expect(toolNames(['logs:environments:view'])).toContain('manage_logging');
    expect(toolNames(['status-page:view'])).toContain('manage_status_page');
    expect(toolNames(['logs:read'])).toContain('manage_logging');
    expect(isDestructiveTool('manage_logging')).toBe(true);
    expect(isDestructiveTool('manage_status_page')).toBe(true);
  });
});
