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

function createService(dispatch: { sendDockerContainerCommand: ReturnType<typeof vi.fn> }) {
  return new DockerManagementService(
    dbWithOnlineDockerNode() as never,
    { log: vi.fn().mockResolvedValue(undefined) } as never,
    dispatch as never,
    { getNode: vi.fn().mockReturnValue({ id: 'node-1' }) } as never
  );
}

describe('DockerManagementService runtime settings', () => {
  it('clears persisted runtime settings when live update receives default runtime values', async () => {
    const inspect = {
      Id: 'container-1',
      Name: '/api',
      Config: {
        Labels: {},
        Env: [],
      },
      HostConfig: {},
      State: { Status: 'exited' },
    };
    const dispatch = {
      sendDockerContainerCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify(inspect),
      }),
    };
    const service = createService(dispatch);
    const replace = vi.fn().mockResolvedValue(undefined);
    service.setRuntimeSettingsService({
      get: vi
        .fn()
        .mockResolvedValueOnce({
          restartPolicy: 'always',
          memoryLimit: 268_435_456,
          memorySwap: -1,
          nanoCPUs: 500_000_000,
          cpuShares: 512,
          pidsLimit: 128,
        })
        .mockResolvedValueOnce(null),
      replace,
    } as never);

    await service.liveUpdateContainer(
      'node-1',
      'container-1',
      {
        restartPolicy: 'no',
        maxRetries: 0,
        memoryLimit: 0,
        memorySwap: 0,
        nanoCPUs: 0,
        cpuShares: 0,
        pidsLimit: 0,
      },
      'user-1'
    );

    expect(replace).toHaveBeenCalledWith('node-1', 'api', {});
    expect(dispatch.sendDockerContainerCommand).not.toHaveBeenCalledWith('node-1', 'live_update', expect.anything());
  });

  it('merges partial runtime setting updates with persisted values', async () => {
    const inspect = {
      Id: 'container-1',
      Name: '/api',
      Config: {
        Labels: {},
        Env: [],
      },
      HostConfig: {},
      State: { Status: 'exited' },
    };
    const dispatch = {
      sendDockerContainerCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify(inspect),
      }),
    };
    const service = createService(dispatch);
    const replace = vi.fn().mockResolvedValue(undefined);
    service.setRuntimeSettingsService({
      get: vi
        .fn()
        .mockResolvedValueOnce({
          restartPolicy: 'on-failure',
          maxRetries: 3,
          memoryLimit: 268_435_456,
        })
        .mockResolvedValueOnce(null),
      replace,
    } as never);

    await service.liveUpdateContainer('node-1', 'container-1', { nanoCPUs: 750_000_000 }, 'user-1');

    expect(replace).toHaveBeenCalledWith('node-1', 'api', {
      restartPolicy: 'on-failure',
      maxRetries: 3,
      memoryLimit: 268_435_456,
      nanoCPUs: 750_000_000,
    });
  });

  it('applies persisted runtime settings to inspect results without dropping existing HostConfig fields', async () => {
    const dispatch = {
      sendDockerContainerCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify({
          Id: 'container-1',
          Name: '/api',
          Config: {
            Env: ['PUBLIC=value'],
          },
          HostConfig: {
            RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
            Binds: ['/data:/data'],
          },
        }),
      }),
    };
    const service = createService(dispatch);
    service.setRuntimeSettingsService({
      get: vi.fn().mockResolvedValue({
        restartPolicy: 'on-failure',
        maxRetries: 3,
        memoryLimit: 268_435_456,
        memorySwap: -1,
        nanoCPUs: 500_000_000,
        cpuShares: 512,
        pidsLimit: 128,
      }),
    } as never);

    const inspect = await service.inspectContainer('node-1', 'container-1');

    expect(inspect.HostConfig).toMatchObject({
      RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
      Binds: ['/data:/data'],
      Memory: 268_435_456,
      MemorySwap: -1,
      NanoCPUs: 500_000_000,
      CPUPeriod: 100000,
      CPUQuota: 50000,
      CpuShares: 512,
      PidsLimit: 128,
    });
  });
});
