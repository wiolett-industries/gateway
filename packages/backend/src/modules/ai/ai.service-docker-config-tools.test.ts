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

describe('AIService Docker container config tool routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes environment reads and updates with resource-scoped environment permissions', async () => {
    const dockerService = {
      getContainerEnv: vi.fn().mockResolvedValue({ FOO: 'bar' }),
      updateContainerEnv: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = createService(dockerService);
    const user = { ...BASE_USER, scopes: ['docker:containers:environment:node-1'] };

    await expect(
      service.executeTool(user, 'manage_docker_container_config', {
        operation: 'get_env',
        nodeId: 'node-1',
        containerId: 'container-1',
      })
    ).resolves.toMatchObject({
      result: { FOO: 'bar' },
      invalidateStores: [],
    });
    expect(dockerService.getContainerEnv).toHaveBeenCalledWith('node-1', 'container-1');

    await expect(
      service.executeTool(user, 'manage_docker_container_config', {
        operation: 'update_env',
        nodeId: 'node-1',
        containerId: 'container-1',
        env: { FOO: 'baz' },
        removeEnv: ['OLD'],
      })
    ).resolves.toMatchObject({
      result: { success: true },
      invalidateStores: [],
    });
    expect(dockerService.updateContainerEnv).toHaveBeenCalledWith(
      'node-1',
      'container-1',
      { FOO: 'baz' },
      ['OLD'],
      'user-1'
    );
  });

  it('routes file writes with parsed path/content and returns a success envelope', async () => {
    const dockerService = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(dockerService);

    await expect(
      service.executeTool(
        { ...BASE_USER, scopes: ['docker:containers:files:node-1'] },
        'manage_docker_container_config',
        {
          operation: 'write_file',
          nodeId: 'node-1',
          containerId: 'container-1',
          path: '/etc/app.conf',
          content: 'ZW5hYmxlZD10cnVl',
        }
      )
    ).resolves.toMatchObject({
      result: { success: true },
      invalidateStores: [],
    });
    expect(dockerService.writeFile).toHaveBeenCalledWith(
      'node-1',
      'container-1',
      '/etc/app.conf',
      'ZW5hYmxlZD10cnVl',
      'user-1'
    );
  });

  it('delegates health-check reads through the health check service', async () => {
    const dockerService = {};
    const healthService = {
      getContainer: vi.fn().mockResolvedValue({ enabled: true }),
    };
    vi.spyOn(container, 'resolve').mockReturnValue(healthService as never);
    const service = createService(dockerService);

    await expect(
      service.executeTool(
        { ...BASE_USER, scopes: ['docker:containers:view:node-1'] },
        'manage_docker_container_config',
        {
          operation: 'get_health_check',
          nodeId: 'node-1',
          containerName: 'api',
        }
      )
    ).resolves.toMatchObject({
      result: { enabled: true },
      invalidateStores: [],
    });
    expect(healthService.getContainer).toHaveBeenCalledWith('node-1', 'api');
  });
});
