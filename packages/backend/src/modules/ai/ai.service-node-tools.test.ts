import { describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [] as string[],
  isBlocked: false,
};

function createService(nodesService: Record<string, unknown>) {
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
    { log: vi.fn() } as never,
    {} as never,
    nodesService as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe('AIService node tool routing', () => {
  it('lists nodes through compact agent-safe rows and scoped allowed ids', async () => {
    const nodesService = {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'node-1',
            type: 'docker',
            hostname: 'docker-1.internal',
            displayName: 'Docker 1',
            status: 'online',
            isConnected: true,
            serviceCreationLocked: false,
            daemonVersion: '1.2.3',
            osInfo: 'linux',
            configVersionHash: 'hash-1',
            capabilities: { docker: true },
            lastSeenAt: '2026-06-01T00:00:00.000Z',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
            enrollmentToken: 'must-not-leak',
          },
        ],
        page: 2,
        limit: 10,
        total: 1,
      }),
    };
    const service = createService(nodesService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['nodes:details:node-1'] }, 'list_nodes', {
        search: 'docker',
        type: 'docker',
        status: 'online',
        page: 2,
        limit: 10,
      })
    ).resolves.toEqual({
      result: {
        data: [
          {
            id: 'node-1',
            type: 'docker',
            hostname: 'docker-1.internal',
            displayName: 'Docker 1',
            status: 'online',
            isConnected: true,
            serviceCreationLocked: false,
            daemonVersion: '1.2.3',
            osInfo: 'linux',
            configVersionHash: 'hash-1',
            capabilities: { docker: true },
            lastSeenAt: '2026-06-01T00:00:00.000Z',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
        page: 2,
        limit: 10,
        total: 1,
      },
      invalidateStores: [],
    });
    expect(nodesService.list).toHaveBeenCalledWith(
      { search: 'docker', type: 'docker', status: 'online', page: 2, limit: 10 },
      { allowedIds: ['node-1'] }
    );
  });

  it('routes node reads and mutations to the node service', async () => {
    const nodesService = {
      get: vi.fn().mockResolvedValue({ id: 'node-1' }),
      create: vi.fn().mockResolvedValue({ id: 'node-2' }),
      update: vi.fn().mockResolvedValue({ id: 'node-1', displayName: 'Proxy' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(nodesService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['nodes:details:node-1'] }, 'get_node', { nodeId: 'node-1' })
    ).resolves.toEqual({ result: { id: 'node-1' }, invalidateStores: [] });
    expect(nodesService.get).toHaveBeenCalledWith('node-1');

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['nodes:create'] }, 'create_node', {
        hostname: 'proxy-1.internal',
        displayName: 'Proxy 1',
      })
    ).resolves.toEqual({ result: { id: 'node-2' }, invalidateStores: ['nodes'] });
    expect(nodesService.create).toHaveBeenCalledWith(
      { hostname: 'proxy-1.internal', type: 'nginx', displayName: 'Proxy 1' },
      'user-1'
    );

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['nodes:rename:node-1'] }, 'rename_node', {
        nodeId: 'node-1',
        displayName: 'Proxy',
      })
    ).resolves.toEqual({ result: { id: 'node-1', displayName: 'Proxy' }, invalidateStores: ['nodes'] });
    expect(nodesService.update).toHaveBeenCalledWith('node-1', { displayName: 'Proxy' }, 'user-1');

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['nodes:delete:node-1'] }, 'delete_node', { nodeId: 'node-1' })
    ).resolves.toEqual({ result: { success: true }, invalidateStores: ['nodes'] });
    expect(nodesService.remove).toHaveBeenCalledWith('node-1', 'user-1');
  });

  it('reads, updates, and tests node nginx config through the node dispatch service', async () => {
    const dispatchService = {
      readGlobalConfig: vi.fn().mockResolvedValue({ success: true, detail: 'events {}' }),
      updateGlobalConfig: vi.fn().mockResolvedValue({ success: true }),
      testConfig: vi.fn().mockResolvedValue({ success: true, detail: 'nginx: syntax is ok' }),
    };
    const resolveSpy = vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === NodeDispatchService) return dispatchService as never;
      throw new Error('Unexpected container resolve');
    });
    const service = createService({});

    try {
      await expect(
        service.executeTool({ ...BASE_USER, scopes: ['nodes:config:view:node-1'] }, 'manage_node_config', {
          operation: 'read',
          nodeId: 'node-1',
        })
      ).resolves.toEqual({ result: { nodeId: 'node-1', content: 'events {}' }, invalidateStores: ['nodes'] });
      expect(dispatchService.readGlobalConfig).toHaveBeenCalledWith('node-1');

      await expect(
        service.executeTool({ ...BASE_USER, scopes: ['nodes:config:edit:node-1'] }, 'manage_node_config', {
          operation: 'update',
          nodeId: 'node-1',
          content: 'events { worker_connections 1024; }',
        })
      ).resolves.toEqual({ result: { nodeId: 'node-1', valid: true, error: null }, invalidateStores: ['nodes'] });
      expect(dispatchService.updateGlobalConfig).toHaveBeenCalledWith(
        'node-1',
        'events { worker_connections 1024; }',
        ''
      );

      await expect(
        service.executeTool({ ...BASE_USER, scopes: ['nodes:config:edit:node-1'] }, 'manage_node_config', {
          operation: 'test',
          nodeId: 'node-1',
        })
      ).resolves.toEqual({
        result: { nodeId: 'node-1', valid: true, output: 'nginx: syntax is ok', error: null },
        invalidateStores: ['nodes'],
      });
      expect(dispatchService.testConfig).toHaveBeenCalledWith('node-1');
    } finally {
      resolveSpy.mockRestore();
    }
  });
});
