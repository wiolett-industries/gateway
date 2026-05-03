import { describe, expect, it, vi } from 'vitest';
import { DockerWebhookService } from './docker-webhook.service.js';

describe('DockerWebhookService', () => {
  function createService() {
    const docker = {
      inspectContainer: vi.fn().mockResolvedValue({
        Config: {
          Image: 'registry.example.com/team/app:old',
        },
        HostConfig: {},
        NetworkingConfig: {},
      }),
      requireNoTransition: vi.fn(),
      setTransition: vi.fn(),
      emitTransition: vi.fn(),
      clearTransition: vi.fn(),
      recreateWithConfig: vi.fn().mockResolvedValue({}),
      listImages: vi.fn().mockResolvedValue([]),
      listContainers: vi.fn().mockResolvedValue([]),
      removeImage: vi.fn().mockResolvedValue(undefined),
    };

    const tasks = {
      create: vi.fn().mockResolvedValue({ id: 'task-1' }),
      update: vi.fn().mockResolvedValue({}),
    };

    const dispatch = {
      sendDockerImageCommand: vi.fn().mockResolvedValue({ success: true }),
    };

    const registry = {
      resolveAuthCandidatesForImagePull: vi.fn().mockResolvedValue([
        {
          registryId: 'registry-1',
          url: 'registry.example.com',
          authJson: 'encoded-auth',
        },
      ]),
      rememberImageRegistry: vi.fn().mockResolvedValue(undefined),
    };

    const cleanup = {
      scheduleCleanupForContainer: vi.fn().mockResolvedValue(undefined),
    };

    const service = new DockerWebhookService(
      {} as never,
      docker as never,
      tasks as never,
      { log: vi.fn().mockResolvedValue({}) } as never,
      dispatch as never,
      registry as never,
      cleanup as never
    );
    const getByContainer = vi.spyOn(service, 'getByContainer').mockResolvedValue(null as never);

    return { cleanup, dispatch, docker, getByContainer, registry, service };
  }

  it('passes resolved registry auth to webhook image pulls', async () => {
    const { dispatch, docker, registry, service } = createService();

    await service.triggerUpdate({
      nodeId: 'node-1',
      containerId: 'container-1',
      containerName: 'app',
      tag: 'new',
      webhookId: 'webhook-1',
    });

    expect(registry.resolveAuthCandidatesForImagePull).toHaveBeenCalledWith(
      'node-1',
      'registry.example.com/team/app:new'
    );
    expect(dispatch.sendDockerImageCommand).toHaveBeenCalledWith(
      'node-1',
      'pull',
      { imageRef: 'registry.example.com/team/app:new', registryAuthJson: 'encoded-auth' },
      600000
    );
    expect(registry.rememberImageRegistry).toHaveBeenCalledWith(
      'node-1',
      'registry.example.com/team/app:new',
      'registry-1'
    );
    expect(docker.recreateWithConfig).toHaveBeenCalledWith(
      'node-1',
      'container-1',
      expect.objectContaining({ image: 'registry.example.com/team/app:new' }),
      null,
      { skipImagePull: true, skipWebhookCleanup: true }
    );
  });
});
