import { describe, expect, it } from 'vitest';
import { listAvailableMcpTools } from './mcp-tools.js';

function toolNames(scopes: string[]): string[] {
  return listAvailableMcpTools(scopes).map((tool) => tool.name);
}

function toolByName(scopes: string[], name: string) {
  return listAvailableMcpTools(scopes).find((tool) => tool.name === name);
}

describe('MCP tool scope filtering', () => {
  it('requires direct database view before advertising database query tools', () => {
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('manage_postgres_data');
    expect(toolNames(['databases:query:read:db-1'])).not.toContain('manage_redis_data');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-2'])).not.toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('query_postgres_read');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:write:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:admin:db-1'])).toContain('execute_postgres_sql');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('manage_postgres_data');
    expect(toolNames(['databases:view:db-1', 'databases:query:read:db-1'])).toContain('manage_redis_data');
  });

  it('does not advertise rendered proxy config reads through raw write implication', () => {
    expect(toolNames(['proxy:raw:write:proxy-1'])).not.toContain('get_proxy_rendered_config');
    expect(toolNames(['proxy:raw:read:proxy-1'])).toContain('get_proxy_rendered_config');
  });

  it('advertises registry selection for Docker create and pull tools', () => {
    const createTool = toolByName(['docker:containers:create'], 'create_docker_container');
    const pullTool = toolByName(['docker:images:pull'], 'pull_docker_image');

    expect(createTool?.parameters.properties).toHaveProperty('registryId');
    expect(pullTool?.parameters.properties).toHaveProperty('registryId');
  });

  it('advertises aggregated MCP tools through any matching delegated scope', () => {
    expect(toolNames(['pki:cert:export:cert-1'])).toContain('manage_certificate');
    expect(toolNames(['pki:templates:edit'])).toContain('manage_template');
    expect(toolNames(['proxy:templates:delete:template-1'])).toContain('manage_proxy_template');
    expect(toolNames(['ssl:cert:delete:cert-1'])).toContain('manage_ssl_certificate');
    expect(toolNames(['domains:edit'])).toContain('manage_domain');
    expect(toolNames(['acl:edit:acl-1'])).toContain('manage_access_list');
    expect(toolNames(['docker:registries:delete'])).toContain('manage_docker_registry');
    expect(toolNames(['docker:volumes:delete:node-1'])).toContain('manage_docker_volume');
    expect(toolNames(['docker:networks:edit:node-1'])).toContain('manage_docker_network');
    expect(toolNames(['docker:containers:files:node-1'])).toContain('manage_docker_container_config');
    expect(toolNames(['databases:credentials:reveal:db-1'])).toContain('manage_database_connection');
    expect(toolNames(['logs:read:env-1'])).toContain('manage_logging');
    expect(toolNames(['status-page:incidents:resolve'])).toContain('manage_status_page');
  });
});
