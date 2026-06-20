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

function databaseToolNamesForScopes(scopes: string[]): string[] {
  const databaseToolNames = new Set(AI_TOOLS.filter((tool) => tool.category === 'Databases').map((tool) => tool.name));
  return toolNames(scopes).filter((name) => databaseToolNames.has(name));
}

function dockerToolNamesForScopes(scopes: string[]): string[] {
  const dockerToolNames = new Set(AI_TOOLS.filter((tool) => tool.category === 'Docker').map((tool) => tool.name));
  return toolNames(scopes).filter((name) => dockerToolNames.has(name));
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

  it('keeps database tool registry contracts stable', () => {
    const databaseToolNames = AI_TOOLS.filter((tool) => tool.category === 'Databases').map((tool) => tool.name);

    expect(databaseToolNames).toEqual([
      'list_databases',
      'get_database_connection',
      'query_postgres_read',
      'execute_postgres_sql',
      'browse_redis_keys',
      'get_redis_key',
      'set_redis_key',
      'execute_redis_command',
      'manage_database_connection',
      'manage_postgres_data',
      'manage_redis_data',
    ]);
    expect(databaseToolNamesForScopes(['databases:view'])).toEqual([
      'list_databases',
      'get_database_connection',
      'manage_database_connection',
    ]);
    expect(databaseToolNamesForScopes(['databases:view', 'databases:query:read'])).toEqual([
      'list_databases',
      'get_database_connection',
      'query_postgres_read',
      'execute_postgres_sql',
      'browse_redis_keys',
      'get_redis_key',
      'manage_database_connection',
      'manage_postgres_data',
      'manage_redis_data',
    ]);
    expect(isDestructiveTool('query_postgres_read')).toBe(false);
    expect(isDestructiveTool('execute_postgres_sql')).toBe(true);
    expect(isDestructiveTool('manage_database_connection')).toBe(true);
  });

  it('keeps docker tool registry contracts stable', () => {
    const dockerToolNames = AI_TOOLS.filter((tool) => tool.category === 'Docker').map((tool) => tool.name);

    expect(dockerToolNames).toEqual([
      'create_docker_container',
      'list_docker_containers',
      'get_docker_container',
      'list_docker_deployments',
      'get_docker_deployment',
      'start_docker_deployment',
      'stop_docker_deployment',
      'restart_docker_deployment',
      'kill_docker_deployment',
      'deploy_docker_deployment',
      'switch_docker_deployment_slot',
      'rollback_docker_deployment',
      'stop_docker_deployment_slot',
      'start_docker_container',
      'stop_docker_container',
      'restart_docker_container',
      'remove_docker_container',
      'update_docker_container_image',
      'rename_docker_container',
      'duplicate_docker_container',
      'get_docker_container_stats',
      'get_docker_container_logs',
      'list_docker_images',
      'pull_docker_image',
      'remove_docker_image',
      'prune_docker_images',
      'list_docker_volumes',
      'list_docker_networks',
      'manage_docker_registry',
      'manage_docker_volume',
      'manage_docker_network',
      'manage_docker_task',
      'manage_docker_container_config',
    ]);
    expect(dockerToolNamesForScopes(['docker:containers:view'])).toEqual([
      'list_docker_containers',
      'get_docker_container',
      'list_docker_deployments',
      'get_docker_deployment',
      'get_docker_container_stats',
      'get_docker_container_logs',
      'manage_docker_container_config',
    ]);
    expect(dockerToolNamesForScopes(['docker:containers:manage'])).toEqual([
      'list_docker_containers',
      'get_docker_container',
      'list_docker_deployments',
      'get_docker_deployment',
      'start_docker_deployment',
      'stop_docker_deployment',
      'restart_docker_deployment',
      'kill_docker_deployment',
      'deploy_docker_deployment',
      'switch_docker_deployment_slot',
      'rollback_docker_deployment',
      'stop_docker_deployment_slot',
      'start_docker_container',
      'stop_docker_container',
      'restart_docker_container',
      'update_docker_container_image',
      'get_docker_container_stats',
      'get_docker_container_logs',
      'manage_docker_container_config',
    ]);
    expect(dockerToolNamesForScopes(['docker:images:view'])).toEqual(['list_docker_images']);
    expect(dockerToolNamesForScopes(['docker:volumes:view'])).toEqual(['list_docker_volumes']);
    expect(dockerToolNamesForScopes(['docker:networks:view'])).toEqual(['list_docker_networks']);
    expect(AI_TOOLS.find((tool) => tool.name === 'create_docker_container')?.invalidateStores).toEqual(['containers']);
    expect(AI_TOOLS.find((tool) => tool.name === 'deploy_docker_deployment')?.invalidateStores).toEqual([
      'containers',
      'tasks',
    ]);
    expect(isDestructiveTool('list_docker_containers')).toBe(false);
    expect(isDestructiveTool('create_docker_container')).toBe(true);
    expect(isDestructiveTool('manage_docker_task')).toBe(false);
  });
});
