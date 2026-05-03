import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { DockerDeploymentService } from '@/modules/docker/docker-deployment.service.js';
import { ProxyService } from '@/modules/proxy/proxy.service.js';
import type { User } from '@/types.js';
import { registerMcpResources } from './mcp-resources.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['nodes:details', 'nodes:create'],
  isBlocked: false,
};

function createService({
  nodesService,
  proxyService = {},
  dockerService = {},
  databaseService = {},
  caService = {},
  auditService,
}: {
  nodesService: { list?: ReturnType<typeof vi.fn>; create?: ReturnType<typeof vi.fn> };
  proxyService?: Record<string, ReturnType<typeof vi.fn>>;
  dockerService?: Record<string, ReturnType<typeof vi.fn>>;
  databaseService?: Record<string, ReturnType<typeof vi.fn>>;
  caService?: Record<string, ReturnType<typeof vi.fn>>;
  auditService: { log: ReturnType<typeof vi.fn> };
}) {
  return new AIService(
    {} as never,
    caService as never,
    {} as never,
    {} as never,
    proxyService as never,
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
    dockerService as never
  );
}

afterEach(() => {
  container.reset();
});

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

    const result = await service.executeTool(USER, 'list_nodes', {}, { source: 'mcp', scopes: ['nodes:details'] });

    expect(result.error).toBeUndefined();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('returns compact node list payloads without bulky health report blobs', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const nodesService = {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'node-1',
            type: 'docker',
            hostname: 'docker-1',
            displayName: 'Docker 1',
            status: 'online',
            isConnected: true,
            serviceCreationLocked: false,
            daemonVersion: '1.0.0',
            osInfo: 'linux',
            configVersionHash: 'hash',
            capabilities: { dockerVersion: '26.0.0' },
            lastSeenAt: new Date('2026-04-30T00:00:00.000Z'),
            lastHealthReport: { healthChecks: Array.from({ length: 100 }, (_, index) => ({ index })) },
            lastStatsReport: { history: Array.from({ length: 100 }, (_, index) => ({ index })) },
            healthHistory: Array.from({ length: 100 }, (_, index) => ({ index })),
            metadata: { noisy: true },
            createdAt: new Date('2026-04-29T00:00:00.000Z'),
            updatedAt: new Date('2026-04-30T00:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
    };
    const service = createService({ nodesService, auditService });

    const result = await service.executeTool(USER, 'list_nodes', {}, { source: 'mcp', scopes: ['nodes:details'] });

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      data: [
        {
          id: 'node-1',
          type: 'docker',
          hostname: 'docker-1',
          status: 'online',
          isConnected: true,
        },
      ],
      total: 1,
    });
    expect(JSON.stringify(result.result)).not.toContain('lastHealthReport');
    expect(JSON.stringify(result.result)).not.toContain('lastStatsReport');
    expect(JSON.stringify(result.result)).not.toContain('healthHistory');
  });

  it('returns compact proxy host list payloads without health history or detailed health check body', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      listProxyHosts: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'proxy-1',
            type: 'proxy',
            domainNames: ['app.example.com'],
            enabled: true,
            nodeId: 'node-1',
            forwardScheme: 'http',
            forwardHost: 'app',
            forwardPort: 3000,
            sslEnabled: true,
            sslForced: true,
            sslCertificateId: 'cert-1',
            accessListId: null,
            healthCheckEnabled: true,
            healthCheckExpectedBody: 'large expected body',
            healthHistory: Array.from({ length: 100 }, (_, index) => ({ index })),
            healthStatus: 'online',
            effectiveHealthStatus: 'online',
            lastHealthCheckAt: new Date('2026-04-30T00:00:00.000Z'),
            rawConfig: 'proxy_set_header X-Test value;',
            rawConfigEnabled: true,
            createdAt: new Date('2026-04-29T00:00:00.000Z'),
            updatedAt: new Date('2026-04-30T00:00:00.000Z'),
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(USER, 'list_proxy_hosts', {}, { source: 'mcp', scopes: ['proxy:view'] });

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      data: [
        {
          id: 'proxy-1',
          domainNames: ['app.example.com'],
          healthCheckEnabled: true,
          healthStatus: 'online',
        },
      ],
    });
    expect(JSON.stringify(result.result)).not.toContain('healthHistory');
    expect(JSON.stringify(result.result)).not.toContain('healthCheckExpectedBody');
    expect(JSON.stringify(result.result)).not.toContain('rawConfig');
    expect(JSON.stringify(result.result)).not.toContain('rawConfigEnabled');
    expect(JSON.stringify(result.result)).not.toContain('proxy_set_header X-Test value');
  });

  it('returns compact proxy host detail payloads without raw config fields', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      getProxyHost: vi.fn().mockResolvedValue({
        id: 'proxy-1',
        type: 'raw',
        domainNames: ['app.example.com'],
        enabled: true,
        nodeId: 'node-1',
        rawConfig: 'server { proxy_set_header Authorization secret; }',
        rawConfigEnabled: true,
      }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(
      USER,
      'get_proxy_host',
      { proxyHostId: 'proxy-1' },
      { source: 'mcp', scopes: ['proxy:view:proxy-1'] }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ id: 'proxy-1', type: 'raw', domainNames: ['app.example.com'] });
    expect(JSON.stringify(result.result)).not.toContain('rawConfig');
    expect(JSON.stringify(result.result)).not.toContain('rawConfigEnabled');
    expect(JSON.stringify(result.result)).not.toContain('proxy_set_header Authorization');
  });

  it('returns compact proxy mutation payloads without raw config fields', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const rawProxyHost = {
      id: 'proxy-1',
      type: 'raw',
      domainNames: ['app.example.com'],
      enabled: true,
      nodeId: 'node-1',
      forwardHost: 'app',
      forwardPort: 3000,
      rawConfig: 'server { proxy_set_header Authorization secret; }',
      rawConfigEnabled: true,
    };
    const proxyService = {
      createProxyHost: vi.fn().mockResolvedValue(rawProxyHost),
      updateProxyHost: vi.fn().mockResolvedValue(rawProxyHost),
      getProxyHost: vi.fn().mockResolvedValue(rawProxyHost),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const results = await Promise.all([
      service.executeTool(
        USER,
        'create_proxy_host',
        { nodeId: 'node-1', domainNames: ['app.example.com'], forwardHost: 'app', forwardPort: 3000 },
        { source: 'mcp', scopes: ['proxy:create'] }
      ),
      service.executeTool(
        USER,
        'update_proxy_host',
        { proxyHostId: 'proxy-1', enabled: false },
        { source: 'mcp', scopes: ['proxy:edit:proxy-1'] }
      ),
      service.executeTool(
        USER,
        'update_proxy_raw_config',
        { proxyHostId: 'proxy-1', rawConfig: 'server { return 204; }' },
        { source: 'mcp', scopes: ['proxy:raw:write:proxy-1'] }
      ),
      service.executeTool(
        USER,
        'toggle_proxy_raw_mode',
        { proxyHostId: 'proxy-1', enabled: true },
        { source: 'mcp', scopes: ['proxy:raw:toggle:proxy-1'] }
      ),
    ]);

    for (const result of results) {
      expect(result.error).toBeUndefined();
      expect(result.result).toMatchObject({ id: 'proxy-1', type: 'raw', domainNames: ['app.example.com'] });
      expect(JSON.stringify(result.result)).not.toContain('rawConfig');
      expect(JSON.stringify(result.result)).not.toContain('rawConfigEnabled');
      expect(JSON.stringify(result.result)).not.toContain('proxy_set_header Authorization');
    }
  });

  it('rejects raw proxy field smuggling through generic proxy host updates', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      updateProxyHost: vi.fn().mockResolvedValue({ id: 'proxy-1' }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['proxy:edit:proxy-1'] },
      'update_proxy_host',
      { proxyHostId: 'proxy-1', rawConfig: 'server { return 204; }' },
      { source: 'mcp', scopes: ['proxy:edit:proxy-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(result.error).toBe('Raw config changes require dedicated raw config tools');
    expect(proxyService.updateProxyHost).not.toHaveBeenCalled();
  });

  it('requires explicit raw read scope before returning rendered proxy config through MCP', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      getProxyHost: vi.fn().mockResolvedValue({ id: 'proxy-1' }),
      getRenderedConfig: vi.fn().mockResolvedValue('server { return 204; }'),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const denied = await service.executeTool(
      { ...USER, scopes: ['proxy:raw:write:proxy-1'] },
      'get_proxy_rendered_config',
      { proxyHostId: 'proxy-1' },
      { source: 'mcp', scopes: ['proxy:raw:write:proxy-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(denied.error).toContain('PERMISSION_DENIED');
    expect(proxyService.getRenderedConfig).not.toHaveBeenCalled();

    const allowed = await service.executeTool(
      { ...USER, scopes: ['proxy:raw:read:proxy-1'] },
      'get_proxy_rendered_config',
      { proxyHostId: 'proxy-1' },
      { source: 'mcp', scopes: ['proxy:raw:read:proxy-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(allowed.error).toBeUndefined();
    expect(allowed.result).toEqual({ proxyHostId: 'proxy-1', config: 'server { return 204; }' });
  });

  it('returns MCP proxy host resources without raw config fields', async () => {
    const callbacks: Record<string, (uri: URL) => Promise<unknown>> = {};
    const server = {
      registerResource: vi.fn((_: string, uri: string, __: unknown, read: (uri: URL) => Promise<unknown>) => {
        callbacks[uri] = read;
      }),
    };
    container.registerInstance(ProxyService, {
      listProxyHosts: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'proxy-1',
            type: 'raw',
            domainNames: ['app.example.com'],
            enabled: true,
            nodeId: 'node-1',
            forwardHost: 'app',
            forwardPort: 3000,
            sslEnabled: false,
            healthStatus: 'online',
            effectiveHealthStatus: 'online',
            rawConfig: 'server { proxy_set_header X-Test value; }',
            rawConfigEnabled: true,
          },
        ],
        pagination: { total: 1 },
      }),
    } as unknown as ProxyService);

    registerMcpResources(server as never, ['proxy:view']);

    const result = (await callbacks['gateway://proxy/hosts'](new URL('gateway://proxy/hosts'))) as {
      contents: Array<{ text: string }>;
    };
    const body = JSON.parse(result.contents[0].text);

    expect(body.hosts[0]).toMatchObject({ id: 'proxy-1', type: 'raw', domainNames: ['app.example.com'] });
    expect(JSON.stringify(body)).not.toContain('rawConfig');
    expect(JSON.stringify(body)).not.toContain('rawConfigEnabled');
    expect(JSON.stringify(body)).not.toContain('proxy_set_header X-Test value');
  });

  it('returns compact Docker container list payloads without embedded health check details', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const dockerService = {
      listContainers: vi.fn().mockResolvedValue([
        {
          id: 'container-1',
          name: '/app',
          image: 'app:latest',
          state: 'running',
          status: 'Up 1 hour',
          ports: [{ privatePort: 3000, publicPort: 8080 }],
          labels: { noisy: 'metadata' },
          healthCheckId: 'health-1',
          healthCheckEnabled: true,
          healthStatus: 'online',
          lastHealthCheckAt: new Date('2026-04-30T00:00:00.000Z'),
          healthHistory: Array.from({ length: 100 }, (_, index) => ({ index })),
          healthCheck: { healthHistory: Array.from({ length: 100 }, (_, index) => ({ index })) },
        },
      ]),
    };
    const service = createService({ nodesService: {}, dockerService, auditService });

    const result = await service.executeTool(
      USER,
      'list_docker_containers',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:containers:view:node-1'] }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      data: [
        {
          id: 'container-1',
          name: 'app',
          image: 'app:latest',
          healthCheckEnabled: true,
          healthStatus: 'online',
        },
      ],
      truncated: false,
      total: 1,
    });
    expect(JSON.stringify(result.result)).not.toContain('healthHistory');
    expect(JSON.stringify(result.result)).not.toContain('labels');
  });

  it('returns compact Docker image, volume, and network list payloads for agents', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const dockerService = {
      listImages: vi.fn().mockResolvedValue([
        {
          Id: 'image-1',
          RepoTags: ['app:latest'],
          RepoDigests: ['app@sha256:abc'],
          Created: 123,
          Size: 456,
          Labels: { noisy: 'metadata' },
        },
      ]),
      listVolumes: vi.fn().mockResolvedValue([
        {
          Name: 'data',
          Driver: 'local',
          Mountpoint: '/var/lib/docker/volumes/data/_data',
          UsedBy: Array.from({ length: 101 }, (_, index) => `app-${index}`),
          Labels: { noisy: 'metadata' },
        },
      ]),
      listNetworks: vi.fn().mockResolvedValue([
        {
          Id: 'network-1',
          Name: 'app-net',
          Driver: 'bridge',
          Containers: { a: {}, b: {} },
          IPAM: { Config: Array.from({ length: 100 }, (_, index) => ({ index })) },
        },
      ]),
    };
    const service = createService({ nodesService: {}, dockerService, auditService });

    const images = await service.executeTool(
      USER,
      'list_docker_images',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:images:view:node-1'] }
    );
    const volumes = await service.executeTool(
      USER,
      'list_docker_volumes',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:volumes:view:node-1'] }
    );
    const networks = await service.executeTool(
      USER,
      'list_docker_networks',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:networks:view:node-1'] }
    );

    expect(images.error).toBeUndefined();
    expect(images.result).toMatchObject({
      data: [{ id: 'image-1', repoTags: ['app:latest'], size: 456 }],
      truncated: false,
      total: 1,
    });
    expect(volumes.error).toBeUndefined();
    expect(volumes.result).toMatchObject({
      data: [{ name: 'data', driver: 'local', usedByCount: 101, usedByTruncated: true }],
      truncated: false,
      total: 1,
    });
    expect((volumes.result as any).data[0].usedBy).toHaveLength(100);
    expect(networks.error).toBeUndefined();
    expect(networks.result).toMatchObject({
      data: [{ id: 'network-1', name: 'app-net', containersCount: 2 }],
      truncated: false,
      total: 1,
    });
    expect(JSON.stringify(images.result)).not.toContain('Labels');
    expect(JSON.stringify(volumes.result)).not.toContain('Labels');
    expect(JSON.stringify(networks.result)).not.toContain('IPAM');
    expect(JSON.stringify(networks.result)).not.toContain('"Containers"');
  });

  it('marks agent Docker list payloads as truncated when result caps apply', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const dockerService = {
      listImages: vi.fn().mockResolvedValue(
        Array.from({ length: 1001 }, (_, index) => ({
          Id: `image-${index}`,
          RepoTags: [`app:${index}`],
          Size: index,
        }))
      ),
    };
    const service = createService({ nodesService: {}, dockerService, auditService });

    const result = await service.executeTool(
      USER,
      'list_docker_images',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:images:view:node-1'] }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ truncated: true, total: 1001, limit: 1000 });
    expect((result.result as { data: unknown[] }).data).toHaveLength(1000);
  });

  it('returns compact Docker deployment list payloads without health history or desired env', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const deploymentService = {
      listSummary: vi.fn().mockResolvedValue([
        {
          id: 'dep-1',
          nodeId: 'node-1',
          name: 'app',
          status: 'ready',
          activeSlot: 'blue',
          desiredConfig: { image: 'app:latest', env: { SECRET: 'hidden' } },
          routes: [{ isPrimary: true, hostPort: 8080, containerPort: 3000, host: 'app.example.com', path: '/' }],
          slots: [{ slot: 'blue', status: 'running', image: 'app:latest', containerId: 'container-1' }],
          healthCheck: {
            id: 'health-1',
            enabled: true,
            healthStatus: 'online',
            lastHealthCheckAt: new Date('2026-04-30T00:00:00.000Z'),
            healthHistory: Array.from({ length: 100 }, (_, index) => ({ index })),
          },
          releases: Array.from({ length: 20 }, (_, index) => ({ index })),
          webhook: { secret: 'hidden' },
          createdAt: new Date('2026-04-29T00:00:00.000Z'),
          updatedAt: new Date('2026-04-30T00:00:00.000Z'),
        },
      ]),
    };
    container.registerInstance(DockerDeploymentService, deploymentService as unknown as DockerDeploymentService);
    const service = createService({ nodesService: {}, auditService });

    const result = await service.executeTool(
      USER,
      'list_docker_deployments',
      { nodeId: 'node-1' },
      { source: 'mcp', scopes: ['docker:containers:view:node-1'] }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      data: [
        {
          id: 'dep-1',
          name: 'app',
          desiredImage: 'app:latest',
          healthCheck: { id: 'health-1', enabled: true, healthStatus: 'online' },
        },
      ],
      truncated: false,
      total: 1,
    });
    expect(JSON.stringify(result.result)).not.toContain('healthHistory');
    expect(JSON.stringify(result.result)).not.toContain('SECRET');
    expect(JSON.stringify(result.result)).not.toContain('webhook');
    expect(JSON.stringify(result.result)).not.toContain('releases');
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

  it('blocks non-read Postgres SQL through the read-only database tool', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      executePostgresSql: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['databases:view', 'databases:query:read'] },
      'query_postgres_read',
      {
        databaseId: 'db-1',
        sql: 'delete from users where id = 1',
      }
    );

    expect(result.error).toContain('INVALID_SQL_INTENT');
    expect(databaseService.executePostgresSql).not.toHaveBeenCalled();
  });

  it('requires admin query scope for administrative Postgres SQL through AI/MCP execution', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      executePostgresSql: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const denied = await service.executeTool(
      { ...USER, scopes: ['databases:view', 'databases:query:write'] },
      'execute_postgres_sql',
      {
        databaseId: 'db-1',
        sql: 'alter table users add column disabled boolean',
      }
    );

    expect(denied.error).toContain('PERMISSION_DENIED: Missing required scope databases:query:admin:db-1');
    expect(databaseService.executePostgresSql).not.toHaveBeenCalled();

    const allowed = await service.executeTool(
      { ...USER, scopes: ['databases:view', 'databases:query:admin'] },
      'execute_postgres_sql',
      {
        databaseId: 'db-1',
        sql: 'alter table users add column disabled boolean',
      }
    );

    expect(allowed.error).toBeUndefined();
    expect(databaseService.executePostgresSql).toHaveBeenCalledWith(
      'db-1',
      'alter table users add column disabled boolean',
      USER.id
    );
  });

  it('allows read-only SQL through the generic Postgres execution tool with read query scope', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      executePostgresSql: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['databases:view:db-1', 'databases:query:read:db-1'] },
      'execute_postgres_sql',
      {
        databaseId: 'db-1',
        sql: 'select 1',
      }
    );

    expect(result.error).toBeUndefined();
    expect(databaseService.executePostgresSql).toHaveBeenCalledWith('db-1', 'select 1', USER.id);
  });

  it('allows write SQL through the generic Postgres execution tool with write query scope', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      executePostgresSql: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['databases:view:db-1', 'databases:query:write:db-1'] },
      'execute_postgres_sql',
      {
        databaseId: 'db-1',
        sql: 'update users set disabled = true where id = 1',
      }
    );

    expect(result.error).toBeUndefined();
    expect(databaseService.executePostgresSql).toHaveBeenCalledWith(
      'db-1',
      'update users set disabled = true where id = 1',
      USER.id
    );
  });

  it('filters database list tools to delegated resource-scoped view grants', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      list: vi.fn().mockResolvedValue({ data: [{ id: 'db-1' }], pagination: { page: 1, limit: 100, total: 1 } }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['databases:view:db-1'] },
      'list_databases',
      { search: 'prod' },
      { source: 'mcp', scopes: ['databases:view:db-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(result.error).toBeUndefined();
    expect(databaseService.list).toHaveBeenCalledWith(
      { page: 1, limit: 100, search: 'prod', type: undefined, healthStatus: undefined },
      { allowedIds: ['db-1'] }
    );
  });

  it('does not treat database query scopes as view grants for database list tools', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const databaseService = {
      list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 100, total: 0 } }),
    };
    const service = createService({ nodesService: {}, databaseService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['databases:query:read:db-1'] },
      'list_databases',
      {},
      {
        source: 'mcp',
        scopes: ['databases:query:read:db-1'],
        tokenId: 'token-1',
        tokenPrefix: 'gwo_abc1234',
      }
    );

    expect(result.error).toContain('PERMISSION_DENIED');
    expect(databaseService.list).not.toHaveBeenCalled();
  });

  it('does not authorize proxy host creation from a node-scoped proxy:create grant', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      createProxyHost: vi.fn().mockResolvedValue({ id: 'proxy-1' }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['proxy:create:node-1'] },
      'create_proxy_host',
      { nodeId: 'node-1', domainNames: ['example.com'] },
      { source: 'mcp', scopes: ['proxy:create:node-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(result.error).toContain('PERMISSION_DENIED');
    expect(proxyService.createProxyHost).not.toHaveBeenCalled();
  });

  it('binds resource-scoped intermediate CA creation to the parent CA id', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const service = createService({ nodesService: {}, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['pki:ca:create:intermediate:parent-a'] },
      'create_intermediate_ca',
      {
        parentCaId: 'parent-b',
        commonName: 'Intermediate CA',
        keyAlgorithm: 'rsa-2048',
        validityYears: 5,
      },
      {
        source: 'mcp',
        scopes: ['pki:ca:create:intermediate:parent-a'],
        tokenId: 'token-1',
        tokenPrefix: 'gwo_abc1234',
      }
    );

    expect(result.error).toContain('PERMISSION_DENIED');
  });

  it('filters CA list tools by root/intermediate view scopes', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const caService = {
      getCATree: vi.fn().mockResolvedValue([
        { id: 'root-1', type: 'root', commonName: 'Root' },
        { id: 'int-1', type: 'intermediate', commonName: 'Intermediate' },
      ]),
    };
    const service = new AIService(
      {} as never,
      caService as never,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await service.executeTool({ ...USER, scopes: ['pki:ca:view:intermediate'] }, 'list_cas', {});

    expect(result.result).toEqual([{ id: 'int-1', type: 'intermediate', commonName: 'Intermediate' }]);
  });

  it('enforces target CA type before deleting CAs through AI/MCP tools', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const caService = {
      getCA: vi.fn().mockResolvedValue({ id: 'int-1', type: 'intermediate', commonName: 'Intermediate' }),
      deleteCA: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService({ nodesService: {}, caService, auditService });

    const denied = await service.executeTool(
      { ...USER, scopes: ['pki:ca:revoke:root'] },
      'delete_ca',
      { caId: 'int-1' },
      {
        source: 'mcp',
        scopes: ['pki:ca:revoke:root'],
        tokenId: 'token-1',
        tokenPrefix: 'gwo_abc1234',
      }
    );

    expect(denied.error).toContain('PERMISSION_DENIED: Missing required scope pki:ca:revoke:intermediate');
    expect(caService.deleteCA).not.toHaveBeenCalled();

    const allowed = await service.executeTool(
      { ...USER, scopes: ['pki:ca:revoke:intermediate'] },
      'delete_ca',
      { caId: 'int-1' },
      {
        source: 'mcp',
        scopes: ['pki:ca:revoke:intermediate'],
        tokenId: 'token-1',
        tokenPrefix: 'gwo_abc1234',
      }
    );

    expect(allowed.error).toBeUndefined();
    expect(caService.deleteCA).toHaveBeenCalledWith('int-1', USER.id);
  });

  it('uses delegated MCP scopes for proxy advanced-config secondary checks', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      updateProxyHost: vi.fn().mockResolvedValue({ id: 'proxy-1' }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['proxy:edit', 'proxy:advanced', 'proxy:advanced:bypass'] },
      'update_proxy_host',
      { proxyHostId: 'proxy-1', advancedConfig: 'proxy_set_header Host $host;' },
      { source: 'mcp', scopes: ['proxy:edit'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(result.error).toBe('Advanced config requires proxy:advanced scope');
    expect(proxyService.updateProxyHost).not.toHaveBeenCalled();
  });

  it('allows delegated MCP proxy edits with matching resource-scoped edit scope', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const proxyService = {
      updateProxyHost: vi.fn().mockResolvedValue({ id: 'proxy-1' }),
    };
    const service = createService({ nodesService: {}, proxyService, auditService });

    const result = await service.executeTool(
      { ...USER, scopes: ['proxy:edit', 'proxy:advanced', 'proxy:advanced:bypass'] },
      'update_proxy_host',
      { proxyHostId: 'proxy-1', enabled: false },
      { source: 'mcp', scopes: ['proxy:edit:proxy-1'], tokenId: 'token-1', tokenPrefix: 'gwo_abc1234' }
    );

    expect(result.error).toBeUndefined();
    expect(proxyService.updateProxyHost).toHaveBeenCalledWith(
      'proxy-1',
      { enabled: false },
      USER.id,
      expect.objectContaining({ bypassAdvancedValidation: false })
    );
  });

  it('executes blue/green deployment lifecycle tools through the deployment service', async () => {
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const deploymentService = {
      start: vi.fn().mockResolvedValue({ id: 'dep-1', status: 'ready' }),
    };
    container.registerInstance(DockerDeploymentService, deploymentService as unknown as DockerDeploymentService);
    const service = createService({ nodesService: {}, auditService });

    const result = await service.executeTool(
      USER,
      'start_docker_deployment',
      { nodeId: 'node-1', deploymentId: 'dep-1' },
      { source: 'mcp', scopes: ['docker:containers:manage'], tokenId: 'token-1', tokenPrefix: 'gw_abc1234' }
    );

    expect(result.error).toBeUndefined();
    expect(deploymentService.start).toHaveBeenCalledWith('node-1', 'dep-1', USER.id);
    expect(result.result).toEqual({
      success: true,
      message: 'Deployment started',
      data: { id: 'dep-1', status: 'ready' },
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        action: 'mcp.start_docker_deployment',
        resourceType: 'docker',
        resourceId: 'node-1',
        details: expect.objectContaining({
          source: 'mcp',
          success: true,
          toolName: 'start_docker_deployment',
          arguments: { nodeId: 'node-1', deploymentId: 'dep-1' },
        }),
      })
    );
  });
});
