import 'reflect-metadata';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv, User } from '@/types.js';
import { mcpRoutes } from './mcp.routes.js';

type JsonRecord = Record<string, any>;

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['mcp:use', 'nodes:list', 'nodes:create', 'proxy:list', 'ssl:cert:list', 'status-page:view'],
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

function registerToken(scopes: string[] | null) {
  container.registerInstance(TokensService, {
    validateToken: vi.fn().mockResolvedValue(
      scopes
        ? {
            user: USER,
            scopes,
            tokenId: 'token-1',
            tokenPrefix: 'gw_abc1234',
          }
        : null
    ),
  } as unknown as TokensService);
}

function mcpHeaders(token = 'gw_valid') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-11-25',
  };
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}, token = 'gw_valid') {
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

afterEach(() => {
  container.reset();
});

describe('MCP route authentication', () => {
  it('rejects missing auth', async () => {
    const response = await createApp().request('/api/mcp', { method: 'POST' });

    expect(response.status).toBe(401);
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

  it('rejects valid tokens without mcp:use', async () => {
    registerToken(['nodes:list']);

    const response = await createApp().request('/api/mcp', {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'MCP requires the mcp:use scope' });
  });

  it('returns JSON-RPC method-not-allowed for GET in stateless mode', async () => {
    registerToken(['mcp:use', 'nodes:list']);

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
    registerToken(['mcp:use', 'nodes:list']);

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
    registerToken(['mcp:use', 'nodes:list']);
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
          tokenId: 'token-1',
          tokenPrefix: 'gw_abc1234',
          toolName: 'create_node',
          requiredScope: 'nodes:create',
          arguments: { hostname: 'node-1', enrollmentToken: '[REDACTED]' },
        }),
      })
    );
  });

  it('passes effective token scopes and token metadata to AI tool execution', async () => {
    registerToken(['mcp:use', 'nodes:list']);
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
        scopes: ['mcp:use', 'nodes:list'],
        tokenId: 'token-1',
        tokenPrefix: 'gw_abc1234',
      }
    );
  });
});

describe('MCP resources and prompts', () => {
  it('lists resources filtered by token scopes', async () => {
    registerToken(['mcp:use', 'nodes:list']);

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
    registerToken(['mcp:use', 'nodes:list']);
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

  it('returns an internal docs index filtered by token scopes', async () => {
    registerToken(['mcp:use', 'nodes:list']);

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
    registerToken(['mcp:use', 'nodes:list']);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://docs/nodes',
    });

    const data = JSON.parse(body.result.contents[0].text);
    expect(data.topic).toBe('nodes');
    expect(data.content).toContain('# Nodes');
  });

  it('allows mcp:use tokens to read MCP-safe docs that were AI-gated internally', async () => {
    registerToken(['mcp:use']);

    const { body } = await mcpRequest('resources/read', {
      uri: 'gateway://docs/api',
    });

    const data = JSON.parse(body.result.contents[0].text);
    expect(data.topic).toBe('api');
    expect(data.content).toContain('# Gateway REST API');
  });

  it('lists prompts filtered by token scopes', async () => {
    registerToken(['mcp:use', 'docker:containers:manage', 'docker:images:pull']);

    const { body } = await mcpRequest('prompts/list');
    const names = body.result.prompts.map((prompt: { name: string }) => prompt.name);

    expect(names).toContain('rollout-container-image');
    expect(names).not.toContain('provision-proxy-host');
  });
});
