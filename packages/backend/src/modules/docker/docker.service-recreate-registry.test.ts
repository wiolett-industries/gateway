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
  it('pulls a changed recreate image with resolved private registry credentials', async () => {
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
      sendDockerImageCommand: vi.fn().mockResolvedValue({ success: true, detail: 'registry.example.com/team/app:new' }),
    };
    const service = createService(dispatch);
    const registry = {
      resolveAuthForImagePull: vi.fn().mockResolvedValue({
        url: 'registry.example.com',
        authJson: 'encoded-auth',
      }),
    };
    service.setRegistryService(registry as never);

    await service.recreateWithConfig('node-1', 'container-1', { image: 'registry.example.com/team/app:new' }, 'user-1');

    expect(registry.resolveAuthForImagePull).toHaveBeenCalledWith('node-1', 'registry.example.com/team/app:new');
    expect(dispatch.sendDockerImageCommand).toHaveBeenCalledWith(
      'node-1',
      'pull',
      { imageRef: 'registry.example.com/team/app:new', registryAuthJson: 'encoded-auth' },
      600000
    );
    const recreateCall = dispatch.sendDockerContainerCommand.mock.calls.find((call) => call[1] === 'recreate');
    expect(JSON.parse((recreateCall?.[2] as { configJson: string }).configJson)).toMatchObject({
      image: 'registry.example.com/team/app:new',
    });
  });
});
