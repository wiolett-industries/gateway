import { describe, expect, it } from 'vitest';
import { AI_TOOLS, getOpenAITools, isDestructiveTool, TOOL_STORE_INVALIDATION_MAP } from './ai.tools.js';

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

function sandboxToolNamesForScopes(scopes: string[], sandboxEnabled: boolean): string[] {
  const sandboxToolNames = new Set(AI_TOOLS.filter((tool) => tool.category === 'Sandbox').map((tool) => tool.name));
  return getOpenAITools([], scopes, false, { sandboxEnabled })
    .map((tool) => tool.function.name)
    .filter((name) => sandboxToolNames.has(name));
}

describe('AI tool scope filtering', () => {
  it('keeps core registry ordering, uniqueness, and invalidation contracts stable', () => {
    expect(new Set(AI_TOOLS.map((tool) => tool.name)).size).toBe(AI_TOOLS.length);
    expect(AI_TOOLS.slice(0, 56).map((tool) => tool.name)).toEqual([
      'discover_tools',
      'get_current_context',
      'wait',
      'find_resource',
      'list_cas',
      'get_ca',
      'create_root_ca',
      'create_intermediate_ca',
      'delete_ca',
      'manage_ca',
      'list_certificates',
      'get_certificate',
      'issue_certificate',
      'revoke_certificate',
      'manage_certificate',
      'list_templates',
      'create_template',
      'delete_template',
      'manage_template',
      'list_proxy_hosts',
      'get_proxy_host',
      'create_proxy_host',
      'update_proxy_host',
      'delete_proxy_host',
      'create_proxy_folder',
      'move_hosts_to_folder',
      'delete_proxy_folder',
      'manage_proxy_template',
      'list_ssl_certificates',
      'request_acme_cert',
      'link_internal_cert',
      'manage_ssl_certificate',
      'list_domains',
      'create_domain',
      'delete_domain',
      'manage_domain',
      'list_access_lists',
      'create_access_list',
      'delete_access_list',
      'manage_access_list',
      'list_nodes',
      'get_node',
      'create_node',
      'rename_node',
      'delete_node',
      'get_proxy_rendered_config',
      'update_proxy_raw_config',
      'toggle_proxy_raw_mode',
      'list_users',
      'update_user_role',
      'get_audit_log',
      'get_dashboard_stats',
      'list_groups',
      'create_group',
      'update_group',
      'delete_group',
    ]);
    expect(TOOL_STORE_INVALIDATION_MAP.create_root_ca).toEqual(['ca']);
    expect(TOOL_STORE_INVALIDATION_MAP.manage_certificate).toEqual(['certificates', 'ca']);
    expect(TOOL_STORE_INVALIDATION_MAP.update_proxy_host).toEqual(['proxy']);
    expect(TOOL_STORE_INVALIDATION_MAP.manage_ssl_certificate).toEqual(['ssl']);
    expect(TOOL_STORE_INVALIDATION_MAP.update_user_role).toEqual(['users']);
    expect(isDestructiveTool('find_resource')).toBe(false);
    expect(isDestructiveTool('manage_ca')).toBe(true);
    expect(isDestructiveTool('create_proxy_folder')).toBe(false);
  });

  it('keeps PKI, proxy, SSL, and administration scope filtering stable', () => {
    expect(toolNames(['pki:ca:view:root'])).toEqual(expect.arrayContaining(['list_cas', 'get_ca']));
    expect(toolNames(['pki:cert:view'])).toEqual(
      expect.arrayContaining(['list_certificates', 'get_certificate', 'manage_certificate'])
    );
    expect(toolNames(['pki:templates:view'])).toEqual(expect.arrayContaining(['list_templates', 'manage_template']));
    expect(toolNames(['proxy:view'])).toEqual(expect.arrayContaining(['list_proxy_hosts', 'get_proxy_host']));
    expect(toolNames(['proxy:folders:manage'])).toEqual(
      expect.arrayContaining(['create_proxy_folder', 'move_hosts_to_folder', 'delete_proxy_folder'])
    );
    expect(toolNames(['ssl:cert:view'])).toEqual(
      expect.arrayContaining(['list_ssl_certificates', 'manage_ssl_certificate'])
    );
    expect(toolNames(['admin:users'])).toEqual(expect.arrayContaining(['list_users', 'update_user_role']));
    expect(toolNames(['admin:groups'])).toEqual(
      expect.arrayContaining(['list_groups', 'create_group', 'update_group', 'delete_group'])
    );
    expect(toolNames(['feat:ai:use'])).toEqual(
      expect.arrayContaining([
        'discover_tools',
        'get_current_context',
        'wait',
        'find_resource',
        'get_dashboard_stats',
        'ask_question',
        'internal_documentation',
      ])
    );
    expect(toolNames(['proxy:raw:read:proxy-1'])).toContain('get_proxy_rendered_config');
    expect(toolNames(['proxy:raw:read:proxy-1'])).not.toContain('update_proxy_raw_config');
  });

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

  it('can narrow model-visible tools to base tools plus discovered categories', () => {
    const baseToolNames = getOpenAITools([], ['feat:ai:use', 'logs:schemas:view', 'docker:containers:view'], true, {
      discoveredToolsets: [],
    }).map((tool) => tool.function.name);

    expect(baseToolNames).toEqual(
      expect.arrayContaining([
        'discover_tools',
        'get_current_context',
        'wait',
        'find_resource',
        'ask_question',
        'internal_documentation',
        'web_search',
      ])
    );
    expect(baseToolNames).not.toContain('manage_logging');
    expect(baseToolNames).not.toContain('list_docker_containers');

    const loggingToolNames = getOpenAITools([], ['feat:ai:use', 'logs:schemas:view', 'docker:containers:view'], false, {
      discoveredToolsets: ['Logging'],
    }).map((tool) => tool.function.name);

    expect(loggingToolNames).toContain('manage_logging');
    expect(loggingToolNames).not.toContain('list_docker_containers');
    expect(loggingToolNames).not.toContain('web_search');
  });

  it('keeps logging and status-page tool registry contracts stable', () => {
    const manageLogging = AI_TOOLS.find((tool) => tool.name === 'manage_logging');
    expect(AI_TOOLS.filter((tool) => tool.category === 'Logging').map((tool) => tool.name)).toEqual(['manage_logging']);
    expect(AI_TOOLS.filter((tool) => tool.category === 'Status Page').map((tool) => tool.name)).toEqual([
      'manage_status_page',
    ]);

    expect(manageLogging?.description).toContain('resource: "schema"');
    expect(manageLogging?.description).toContain('operation: "create"');
    expect(toolNames(['logs:environments:view'])).toContain('manage_logging');
    expect(toolNames(['logs:environments:view'])).toContain('find_resource');
    expect(toolNames(['logs:schemas:view'])).toContain('find_resource');
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

  it('only advertises sandbox tools when sandbox is enabled and scoped', () => {
    const expectedSandboxTools = [
      'execute_script',
      'run_process',
      'fetch',
      'download_artifact',
      'read_artifact',
      'send_artifact',
      'read_process_output',
      'write_process_stdin',
      'kill_process',
      'list_sandbox_jobs',
    ];

    expect(AI_TOOLS.filter((tool) => tool.category === 'Sandbox').map((tool) => tool.name)).toEqual(
      expectedSandboxTools
    );
    expect(sandboxToolNamesForScopes(['ai:sandbox:use'], false)).toEqual([]);
    expect(sandboxToolNamesForScopes([], true)).toEqual([]);
    expect(sandboxToolNamesForScopes(['ai:sandbox:use'], true)).toEqual(expectedSandboxTools);
    expect(isDestructiveTool('execute_script')).toBe(true);
    expect(isDestructiveTool('run_process')).toBe(true);
    expect(isDestructiveTool('fetch')).toBe(false);
    expect(isDestructiveTool('download_artifact')).toBe(false);
    expect(isDestructiveTool('read_artifact')).toBe(false);
    expect(isDestructiveTool('send_artifact')).toBe(false);
    expect(isDestructiveTool('read_process_output')).toBe(false);
    expect(isDestructiveTool('list_sandbox_jobs')).toBe(false);
  });
});
