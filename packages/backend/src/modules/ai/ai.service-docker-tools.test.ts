import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
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

function createService(dockerService: Record<string, unknown>) {
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
    {} as never,
    {} as never,
    {} as never,
    dockerService as never
  );
}

describe('AIService Docker tool routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists Docker containers with search filtering and compact agent payloads', async () => {
    const dockerService = {
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: 'container-1',
          Name: '/api',
          Image: 'registry.example.com/team/api:latest',
          State: 'running',
          Status: 'Up 1 hour',
          Ports: [{ privatePort: 3000, publicPort: 8080, type: 'tcp' }],
        },
        {
          Id: 'container-2',
          Name: '/worker',
          Image: 'registry.example.com/team/worker:latest',
          State: 'exited',
          Status: 'Exited',
          Ports: [],
        },
      ]),
    };
    const service = createService(dockerService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:containers:view:node-1'] }, 'list_docker_containers', {
        nodeId: 'node-1',
        search: 'api',
      })
    ).resolves.toEqual({
      result: {
        data: [
          {
            id: 'container-1',
            name: 'api',
            image: 'registry.example.com/team/api:latest',
            state: 'running',
            status: 'Up 1 hour',
            created: undefined,
            ports: [{ privatePort: 3000, publicPort: 8080, type: 'tcp' }],
            portsCount: 1,
            portsTruncated: false,
            kind: 'container',
            deploymentId: undefined,
            activeSlot: undefined,
            healthCheckId: undefined,
            healthCheckEnabled: undefined,
            healthStatus: undefined,
            lastHealthCheckAt: undefined,
            folderId: undefined,
            folderIsSystem: undefined,
            folderSortOrder: undefined,
            _transition: undefined,
          },
        ],
        total: 1,
        limit: 1000,
        truncated: false,
      },
      invalidateStores: [],
    });
    expect(dockerService.listContainers).toHaveBeenCalledWith('node-1');
  });

  it('pulls Docker images with resolved registry auth and registry host prefixing', async () => {
    const dockerService = {
      pullImage: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
    };
    const registryService = {
      resolveAuthForImagePull: vi.fn().mockResolvedValue({
        url: 'registry.example.com',
        authJson: { username: 'robot', password: 'secret' },
        registryId: '11111111-1111-4111-8111-111111111111',
      }),
    };
    vi.spyOn(container, 'resolve').mockReturnValue(registryService as never);
    const service = createService(dockerService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:images:pull:node-1'] }, 'pull_docker_image', {
        nodeId: 'node-1',
        imageRef: 'team/api:next',
        registryId: '11111111-1111-4111-8111-111111111111',
      })
    ).resolves.toEqual({
      result: {
        success: true,
        message: 'Pulling registry.example.com/team/api:next',
        data: { taskId: 'task-1' },
      },
      invalidateStores: ['images'],
    });
    expect(registryService.resolveAuthForImagePull).toHaveBeenCalledWith(
      'node-1',
      'team/api:next',
      '11111111-1111-4111-8111-111111111111'
    );
    expect(dockerService.pullImage).toHaveBeenCalledWith(
      'node-1',
      'registry.example.com/team/api:next',
      { username: 'robot', password: 'secret' },
      'user-1',
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('routes Docker volume create and delete with operation-specific node scopes', async () => {
    const dockerService = {
      createVolume: vi.fn().mockResolvedValue({ Name: 'cache' }),
      removeVolume: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(dockerService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:volumes:create:node-1'] }, 'manage_docker_volume', {
        operation: 'create',
        nodeId: 'node-1',
        name: 'cache',
        driver: 'local',
        labels: { app: 'api' },
      })
    ).resolves.toMatchObject({
      result: { Name: 'cache' },
      invalidateStores: [],
    });
    expect(dockerService.createVolume).toHaveBeenCalledWith(
      'node-1',
      { name: 'cache', driver: 'local', labels: { app: 'api' } },
      'user-1'
    );

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:volumes:delete:node-1'] }, 'manage_docker_volume', {
        operation: 'delete',
        nodeId: 'node-1',
        name: 'cache',
        force: true,
      })
    ).resolves.toMatchObject({
      result: { success: true },
      invalidateStores: [],
    });
    expect(dockerService.removeVolume).toHaveBeenCalledWith('node-1', 'cache', true, 'user-1');
  });

  it('routes Docker network connect through edit scope and parsed container payload', async () => {
    const dockerService = {
      connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(dockerService);

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:networks:edit:node-1'] }, 'manage_docker_network', {
        operation: 'connect',
        nodeId: 'node-1',
        networkId: 'frontend',
        containerId: 'container-1',
      })
    ).resolves.toMatchObject({
      result: { success: true },
      invalidateStores: [],
    });
    expect(dockerService.connectContainerToNetwork).toHaveBeenCalledWith('node-1', 'frontend', 'container-1', 'user-1');
  });

  it('routes deployment lifecycle actions through the deployment service resolver', async () => {
    const deploymentService = {
      start: vi.fn().mockResolvedValue({ id: 'deployment-1', status: 'starting' }),
    };
    vi.spyOn(container, 'resolve').mockReturnValue(deploymentService as never);
    const service = createService({});

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['docker:containers:manage:node-1'] }, 'start_docker_deployment', {
        nodeId: 'node-1',
        deploymentId: 'deployment-1',
      })
    ).resolves.toMatchObject({
      result: {
        success: true,
        message: 'Deployment started',
        data: { id: 'deployment-1', status: 'starting' },
      },
      invalidateStores: ['containers'],
    });
    expect(deploymentService.start).toHaveBeenCalledWith('node-1', 'deployment-1', 'user-1');
  });
});
