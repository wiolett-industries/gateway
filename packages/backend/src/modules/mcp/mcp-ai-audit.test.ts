import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AIService } from '@/modules/ai/ai.service.js';
import type { User } from '@/types.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['nodes:list', 'nodes:create'],
  isBlocked: false,
};

function createService({
  nodesService,
  databaseService = {},
  auditService,
}: {
  nodesService: { list?: ReturnType<typeof vi.fn>; create?: ReturnType<typeof vi.fn> };
  databaseService?: Record<string, ReturnType<typeof vi.fn>>;
  auditService: { log: ReturnType<typeof vi.fn> };
}) {
  return new AIService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auditService as never,
    {} as never,
    nodesService as never,
    {} as never,
    databaseService as never,
    {} as never
  );
}

describe('AIService MCP audit behavior', () => {
  it('writes mcp audit entries for mutating MCP tool calls', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const nodesService = {
      create: vi.fn().mockResolvedValue({ node: { id: 'node-1' }, enrollmentToken: 'gw_node_secret' }),
    };
    const service = createService({ nodesService, auditService });

    const result = await service.executeTool(
      USER,
      'create_node',
      { hostname: 'node-1', type: 'docker' },
      { source: 'mcp', scopes: ['nodes:create'], tokenId: 'token-1', tokenPrefix: 'gw_abc1234' }
    );

    expect(result.error).toBeUndefined();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        action: 'mcp.create_node',
        resourceType: 'nodes',
        details: expect.objectContaining({
          source: 'mcp',
          success: true,
          tokenId: 'token-1',
          tokenPrefix: 'gw_abc1234',
          toolName: 'create_node',
          arguments: { hostname: 'node-1', type: 'docker' },
        }),
      })
    );
  });

  it('writes failed mcp audit entries for mutating MCP tool failures', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const nodesService = {
      create: vi.fn().mockRejectedValue(new Error('create failed')),
    };
    const service = createService({ nodesService, auditService });

    const result = await service.executeTool(
      USER,
      'create_node',
      { hostname: 'node-1', type: 'docker' },
      { source: 'mcp', scopes: ['nodes:create'], tokenId: 'token-1', tokenPrefix: 'gw_abc1234' }
    );

    expect(result.error).toBe('create failed');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.create_node',
        details: expect.objectContaining({
          success: false,
          error: 'create failed',
          tokenId: 'token-1',
        }),
      })
    );
  });

  it('does not audit read-only MCP tool calls', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const nodesService = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
    };
    const service = createService({ nodesService, auditService });

    const result = await service.executeTool(USER, 'list_nodes', {}, { source: 'mcp', scopes: ['nodes:list'] });

    expect(result.error).toBeUndefined();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('keeps existing ai audit entries for mutating AI tool calls', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const nodesService = {
      create: vi.fn().mockResolvedValue({ node: { id: 'node-1' }, enrollmentToken: 'gw_node_secret' }),
    };
    const service = createService({ nodesService, auditService });

    const result = await service.executeTool(USER, 'create_node', { hostname: 'node-1', type: 'docker' });

    expect(result.error).toBeUndefined();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.create_node',
        details: { ai_initiated: true, arguments: { hostname: 'node-1', type: 'docker' } },
      })
    );
  });

  it('requires database view scope in addition to query scope before executing database tools', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      executePostgresSql: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const denied = await service.executeTool({ ...USER, scopes: ['databases:query:read'] }, 'query_postgres_read', {
      databaseId: 'db-1',
      sql: 'select 1',
    });

    expect(denied.error).toContain('PERMISSION_DENIED: Missing required scope databases:view:db-1');
    expect(databaseService.executePostgresSql).not.toHaveBeenCalled();

    const allowed = await service.executeTool(
      { ...USER, scopes: ['databases:view', 'databases:query:read'] },
      'query_postgres_read',
      { databaseId: 'db-1', sql: 'select 1' }
    );

    expect(allowed.error).toBeUndefined();
    expect(databaseService.executePostgresSql).toHaveBeenCalledWith('db-1', 'select 1', USER.id);
  });
});
