import 'reflect-metadata';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import { OAuthService } from '@/modules/oauth/oauth.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv, User } from '@/types.js';
import { mcpRoutes } from './mcp.routes.js';
import { McpSettingsService } from './mcp-settings.service.js';

type JsonRecord = Record<string, any>;

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['mcp:use', 'nodes:details', 'nodes:create', 'proxy:view', 'ssl:cert:view', 'status-page:view'],
  isBlocked: false,
};

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    throw error;
  });
  app.route('/api/mcp', mcpRoutes);
  return app;
}

function registerToken(scopes: string[] | null, user: User = USER) {
  container.registerInstance(TokensService, {
    validateToken: vi.fn().mockResolvedValue(
      scopes
        ? {
            user,
            scopes,
            tokenId: 'token-1',
            tokenPrefix: 'gw_abc1234',
          }
        : null
    ),
  } as unknown as TokensService);
  registerOAuth(scopes, user);
}

function registerMcpSettings(enabled = true) {
  container.registerInstance(McpSettingsService, {
    isEnabled: vi.fn().mockResolvedValue(enabled),
  } as unknown as McpSettingsService);
}

function registerOAuth(scopes: string[] | null = null, user: User = USER) {
  container.registerInstance(OAuthService, {
    getMcpResourceUrl: vi.fn().mockReturnValue('https://gateway.example.com/api/mcp'),
    getApiResourceUrl: vi.fn().mockReturnValue('https://gateway.example.com/api'),
    getProtectedResourceMetadataUrl: vi
      .fn()
      .mockReturnValue('https://gateway.example.com/.well-known/oauth-protected-resource/api/mcp'),
    validateAccessToken: vi.fn().mockResolvedValue(
      scopes
        ? {
            user,
            scopes,
            tokenId: 'oauth-token-1',
            tokenPrefix: 'gwo_abc123',
            clientId: 'goc_client',
          }
        : null
    ),
  } as unknown as OAuthService);
}

function mcpHeaders(token = 'gwo_valid') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-11-25',
  };
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}, token = 'gwo_valid') {
  const response = await createApp().request('/api/mcp', {
    method: 'POST',
    headers: mcpHeaders(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return {
    response,
    body: (await response.json()) as JsonRecord,
  };
}

beforeEach(() => {
  registerMcpSettings(true);
  registerOAuth();
});

afterEach(() => {
  container.reset();
});

describe('MCP route authentication', () => {
  it('rejects requests when the MCP server is disabled', async () => {
    registerMcpSettings(false);

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'MCP server is disabled' });
  });

  it('rejects missing auth', async () => {
    const response = await createApp().request('/api/mcp', { method: 'POST' });
    const challenge = response.headers.get('WWW-Authenticate');

    expect(response.status).toBe(401);
    expect(challenge).toContain('resource_metadata=');
    expect(challenge).not.toContain('scope="mcp:use"');
  });

  it('rejects cookie-only auth', async () => {
    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: { Cookie: 'session_id=session-1' },
    });

    expect(response.status).toBe(401);
  });

  it('rejects invalid gateway tokens', async () => {
    registerToken(null);

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders('gw_invalid'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects logging ingest tokens', async () => {
    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders('gwl_ingest'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects valid tokens with no effective scopes', async () => {
    registerToken([]);

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(403);
  });

  it('rejects Gateway API tokens for MCP', async () => {
    registerToken(['nodes:details']);

    const { response } = await mcpRequest('tools/list', {}, 'gw_valid');

    expect(response.status).toBe(401);
  });

  it('allows OAuth access tokens without mcp:use when the user can use MCP', async () => {
    registerOAuth(['nodes:details']);

    const { response, body } = await mcpRequest('tools/list', {}, 'gwo_valid');

    expect(response.status).toBe(200);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_nodes');
  });

  it('rejects API-resource OAuth access tokens for MCP', async () => {
    const validateAccessToken = vi.fn().mockResolvedValueOnce(null);
    container.registerInstance(OAuthService, {
      getMcpResourceUrl: vi.fn().mockReturnValue('https://gateway.example.com/api/mcp'),
      getApiResourceUrl: vi.fn().mockReturnValue('https://gateway.example.com/api'),
      getProtectedResourceMetadataUrl: vi
        .fn()
        .mockReturnValue('https://gateway.example.com/.well-known/oauth-protected-resource/api/mcp'),
      validateAccessToken,
    } as unknown as OAuthService);

    const { response } = await mcpRequest('tools/list', {}, 'gwo_valid');

    expect(response.status).toBe(401);
    expect(validateAccessToken).toHaveBeenCalledTimes(1);
    expect(validateAccessToken).toHaveBeenCalledWith('gwo_valid', {
      resource: 'https://gateway.example.com/api/mcp',
    });
  });

  it('rejects OAuth access tokens when the user cannot use MCP', async () => {
    registerOAuth(['nodes:details'], { ...USER, scopes: ['nodes:details'] });

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders('gwo_valid'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('WWW-Authenticate')).toContain('insufficient_scope');
  });

  it('rejects API tokens without checking user MCP capability', async () => {
    registerToken(['nodes:details'], { ...USER, scopes: ['nodes:details'] });

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders('gw_valid'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'MCP accepts only Gateway OAuth access tokens' });
  });

  it('returns JSON-RPC method-not-allowed for GET in stateless mode', async () => {
    registerToken(['nodes:details']);

    const response = await createApp().request('/api/mcp', {
      method: 'GET',
      headers: mcpHeaders(),
    });
    const body = (await response.json()) as JsonRecord;

    expect(response.status).toBe(405);
    expect(body.error.code).toBe(-32601);
  });
});

describe('MCP tools', () => {
  it('lists only scoped Gateway tools and excludes AI-only tools', async () => {
    registerToken(['nodes:details']);

    const { response, body } = await mcpRequest('tools/list');

    expect(response.status).toBe(200);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_nodes');
    expect(names).not.toContain('create_node');
    expect(names).not.toContain('ask_question');
    expect(names).not.toContain('internal_documentation');
    expect(names).not.toContain('web_search');
  });

  it('does not call tools hidden by effective token scopes', async () => {
    registerToken(['nodes:details']);
    const executeTool = vi.fn();
    const auditLog = vi.fn().mockResolvedValue(undefined);
    container.registerInstance(AIService, { executeTool } as unknown as AIService);
    container.registerInstance(AuditService, { log: auditLog } as unknown as AuditService);

    const { body } = await mcpRequest('tools/call', {
      name: 'create_node',
      arguments: { hostname: 'node-1', enrollmentToken: 'secret-token' },
    });

    expect(body.result.isError).toBe(true);
    expect(executeTool).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        action: 'mcp.create_node',
        resourceType: 'nodes',
        details: expect.objectContaining({
          source: 'mcp',
          success: false,
          denied: true,
          reason: 'missing_scope',
          tokenId: 'oauth-token-1',
          tokenPrefix: 'gwo_abc123',
          toolName: 'create_node',
          requiredScope: 'nodes:create',
          arguments: { hostname: 'node-1', enrollmentToken: '[REDACTED]' },
        }),
      })
    );
  });

  it('passes effective token scopes and token metadata to AI tool execution', async () => {
    registerToken(['nodes:details']);
    const executeTool = vi.fn().mockResolvedValue({ result: { data: [] }, invalidateStores: [] });
    container.registerInstance(AIService, { executeTool } as unknown as AIService);

    const { body } = await mcpRequest('tools/call', {
      name: 'list_nodes',
      arguments: { limit: 5 },
    });

    expect(body.result.content[0].text).toBe(JSON.stringify({ data: [] }));
    expect(executeTool).toHaveBeenCalledWith(
      USER,
      'list_nodes',
      { limit: 5 },
      {
        source: 'mcp',
        scopes: ['nodes:details'],
        tokenId: 'oauth-token-1',
        tokenPrefix: 'gwo_abc123',
        authType: 'oauth',
        clientId: 'goc_client',
      }
    );
  });

  it('uses corrected granular scopes when listing template and access-list tools', async () => {
    registerToken(['pki:templates:create', 'pki:templates:delete', 'acl:create']);

    const { body } = await mcpRequest('tools/list');
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('create_template');
    expect(names).toContain('delete_template');
    expect(names).toContain('create_access_list');
  });

  it('lists and calls resource-scoped proxy mutation tools for matching resources only', async () => {
    registerToken(['proxy:edit:host-1']);
    const executeTool = vi.fn().mockResolvedValue({ result: { id: 'host-1' }, invalidateStores: [] });
    container.registerInstance(AIService, { executeTool } as unknown as AIService);

    const list = await mcpRequest('tools/list');
    const names = list.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('update_proxy_host');

    const allowed = await mcpRequest('tools/call', {
      name: 'update_proxy_host',
      arguments: { proxyHostId: 'host-1', enabled: false },
    });
    expect(allowed.body.result.isError).not.toBe(true);
    expect(executeTool).toHaveBeenCalledWith(
      USER,
      'update_proxy_host',
      { proxyHostId: 'host-1', enabled: false },
      expect.objectContaining({ scopes: ['proxy:edit:host-1'] })
    );

    executeTool.mockClear();
    container.registerInstance(AuditService, { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService);
    const denied = await mcpRequest('tools/call', {
      name: 'update_proxy_host',
      arguments: { proxyHostId: 'host-2', enabled: false },
    });
    expect(JSON.stringify(denied.body)).toContain('unavailable');
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('does not expose rendered nginx config with ordinary proxy view scope', async () => {
    registerToken(['proxy:view']);

    const { body } = await mcpRequest('tools/list');
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).not.toContain('get_proxy_rendered_config');
  });

  it('lists blue/green deployment tools under Docker container scopes', async () => {
    registerToken(['docker:containers:view', 'docker:containers:view', 'docker:containers:manage']);

    const { body } = await mcpRequest('tools/list');
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('list_docker_deployments');
    expect(names).toContain('get_docker_deployment');
    expect(names).toContain('start_docker_deployment');
    expect(names).toContain('stop_docker_deployment');
    expect(names).toContain('restart_docker_deployment');
    expect(names).toContain('kill_docker_deployment');
    expect(names).toContain('deploy_docker_deployment');
    expect(names).toContain('switch_docker_deployment_slot');
    expect(names).toContain('rollback_docker_deployment');
    expect(names).toContain('stop_docker_deployment_slot');
  });
});

describe('MCP resources and prompts', () => {
  it('lists resources filtered by token scopes', async () => {
    registerToken(['nodes:details']);

    const { body } = await mcpRequest('resources/list');
    const uris = body.result.resources.map((resource: { uri: string }) => resource.uri);

    expect(uris).toContain('gateway://overview');
    expect(uris).toContain('gateway://nodes');
    expect(uris).toContain('gateway://docker/nodes');
    expect(uris).toContain('gateway://docs');
    expect(uris).toContain('gateway://docs/nodes');
    expect(uris).not.toContain('gateway://proxy/hosts');
    expect(uris).not.toContain('gateway://docs/proxy');
  });

  it('returns compact JSON resource content', async () => {
    registerToken(['nodes:details']);
    container.registerInstance(MonitoringService, {
      getDashboardStats: vi.fn().mockResolvedValue({
        proxyHosts: { total: 3 },
        sslCertificates: { total: 4 },
        pkiCertificates: { total: 5 },
        cas: { total: 6 },
        nodes: { total: 2, online: 1, offline: 1, pending: 0 },
      }),
    } as unknown as MonitoringService);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://overview',
    });

    expect(body.result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(body.result.contents[0].text);
    expect(data.nodes).toEqual({ total: 2, online: 1, offline: 1, pending: 0 });
    expect(data.proxyHosts).toBeUndefined();
  });

  it('filters MCP overview CA stats by delegated CA view type', async () => {
    registerToken(['pki:ca:view:intermediate']);
    const getDashboardStats = vi.fn().mockResolvedValue({
      proxyHosts: { total: 3 },
      sslCertificates: { total: 4 },
      pkiCertificates: { total: 5 },
      cas: { total: 1, root: 0, intermediate: 1 },
      nodes: { total: 2, online: 1, offline: 1, pending: 0 },
    });
    container.registerInstance(MonitoringService, { getDashboardStats } as unknown as MonitoringService);

    const list = await mcpRequest('resources/list');
    const uris = list.body.result.resources.map((resource: { uri: string }) => resource.uri);
    expect(uris).toContain('gateway://overview');

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://overview',
    });

    expect(getDashboardStats).toHaveBeenCalledWith(expect.objectContaining({ allowedCaTypes: ['intermediate'] }));
    const data = JSON.parse(body.result.contents[0].text);
    expect(data.cas).toEqual({ total: 1, root: 0, intermediate: 1 });
    expect(data.nodes).toBeUndefined();
  });

  it('returns an internal docs index filtered by token scopes', async () => {
    registerToken(['nodes:details']);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://docs',
    });

    const data = JSON.parse(body.result.contents[0].text);
    const topics = data.topics.map((entry: { topic: string }) => entry.topic);
    expect(topics).toContain('nodes');
    expect(topics).toContain('api');
    expect(topics).toContain('permissions');
    expect(topics).not.toContain('proxy');
  });

  it('returns scoped internal documentation as MCP resource content', async () => {
    registerToken(['nodes:details']);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://docs/nodes',
    });

    const data = JSON.parse(body.result.contents[0].text);
    expect(data.topic).toBe('nodes');
    expect(data.content).toContain('# Nodes');
  });

  it('allows MCP callers to read MCP-safe docs that were AI-gated internally', async () => {
    registerToken(['nodes:details']);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://docs/api',
    });

    const data = JSON.parse(body.result.contents[0].text);
    expect(data.topic).toBe('api');
    expect(data.content).toContain('# Gateway REST API');
  });

  it('lists prompts filtered by token scopes', async () => {
    registerToken(['docker:containers:manage', 'docker:images:pull']);

    const { body } = await mcpRequest('prompts/list');
    const names = body.result.prompts.map((prompt: { name: string }) => prompt.name);

    expect(names).toContain('rollout-container-image');
    expect(names).not.toContain('provision-proxy-host');
  });
});
