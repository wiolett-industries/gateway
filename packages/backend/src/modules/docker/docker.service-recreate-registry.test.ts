import { describe, expect, it, vi } from 'vitest';
import { DockerManagementService } from './docker.service.js';

function dbWithOnlineDockerNode() {
  const limit = vi.fn().mockResolvedValue([
    {
      id: 'node-1',
      type: 'docker',
    },
  ]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select };
}

function createService(dispatch: {
  sendDockerContainerCommand: ReturnType<typeof vi.fn>;
  sendDockerImageCommand: ReturnType<typeof vi.fn>;
}) {
  const service = new DockerManagementService(
    dbWithOnlineDockerNode() as never,
    { log: vi.fn().mockResolvedValue(undefined) } as never,
    dispatch as never,
    { getNode: vi.fn().mockReturnValue({ id: 'node-1' }) } as never
  );
  vi.spyOn(service as never, 'watchRecreateByName').mockImplementation(() => undefined);
  return service;
}

describe('DockerManagementService recreate registry auth', () => {
  it('tries matching private registry credentials until a recreate image pull succeeds', async () => {
    const inspect = {
      Id: 'container-1',
      Name: '/app',
      Config: {
        Image: 'registry.example.com/team/app:old',
        Labels: {},
      },
      State: { Status: 'running' },
    };
    const dispatch = {
      sendDockerContainerCommand: vi.fn(async (_nodeId: string, action: string, payload?: Record<string, unknown>) => {
        if (action === 'inspect') {
          return { success: true, detail: JSON.stringify(inspect) };
        }
        if (action === 'recreate') {
          return { success: true, detail: JSON.stringify({ taskId: 'daemon-task' }), payload };
        }
        return { success: false, error: `unexpected action ${action}` };
      }),
      sendDockerImageCommand: vi.fn(async (_nodeId: string, _action: string, payload: Record<string, unknown>) => {
        if (payload.registryAuthJson === 'stazion-auth') {
          return { success: true, detail: 'registry.example.com/team/app:new' };
        }
        return { success: false, error: 'pull access denied' };
      }),
    };
    const service = createService(dispatch);
    const registry = {
      resolveAuthCandidatesForImagePull: vi.fn().mockResolvedValue([
        {
          registryId: 'registry-generic',
          url: 'registry.example.com',
          authJson: 'generic-auth',
        },
        {
          registryId: 'registry-stazion',
          url: 'registry.example.com',
          authJson: 'stazion-auth',
        },
      ]),
      rememberImageRegistry: vi.fn().mockResolvedValue(undefined),
    };
    service.setRegistryService(registry as never);

    await service.recreateWithConfig('node-1', 'container-1', { image: 'registry.example.com/team/app:new' }, 'user-1');

    expect(registry.resolveAuthCandidatesForImagePull).toHaveBeenCalledWith(
      'node-1',
      'registry.example.com/team/app:new',
      undefined
    );
    expect(dispatch.sendDockerImageCommand).toHaveBeenNthCalledWith(
      1,
      'node-1',
      'pull',
      { imageRef: 'registry.example.com/team/app:new', registryAuthJson: 'generic-auth' },
      600000
    );
    expect(dispatch.sendDockerImageCommand).toHaveBeenNthCalledWith(
      2,
      'node-1',
      'pull',
      { imageRef: 'registry.example.com/team/app:new', registryAuthJson: 'stazion-auth' },
      600000
    );
    const recreateCall = dispatch.sendDockerContainerCommand.mock.calls.find((call) => call[1] === 'recreate');
    expect(JSON.parse((recreateCall?.[2] as { configJson: string }).configJson)).toMatchObject({
      image: 'registry.example.com/team/app:new',
    });
    expect(registry.rememberImageRegistry).toHaveBeenCalledWith(
      'node-1',
      'registry.example.com/team/app:new',
      'registry-stazion'
    );
  });
});
