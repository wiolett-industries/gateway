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

function inspectResult(env: string[]) {
  return {
    success: true,
    detail: JSON.stringify({
      Id: 'container-1',
      Name: '/api',
      Config: {
        Image: 'team/api:latest',
        Env: env,
        Labels: {},
      },
    }),
  };
}

describe('DockerManagementService env operations', () => {
  it('returns stored decrypted environment when it exists', async () => {
    const dispatch = {
      sendDockerContainerCommand: vi.fn().mockResolvedValue(inspectResult(['RUNTIME=value'])),
    };
    const environmentService = {
      getDecryptedMap: vi.fn().mockResolvedValue({ FOO: 'stored', EMPTY: '' }),
      seedFromRuntimeIfMissing: vi.fn(),
    };
    const service = createService(dispatch);
    service.setEnvironmentService(environmentService as never);

    await expect(service.getContainerEnv('node-1', 'container-1')).resolves.toEqual(['FOO=stored', 'EMPTY=']);
    expect(dispatch.sendDockerContainerCommand).toHaveBeenCalledTimes(2);
    expect(environmentService.getDecryptedMap).toHaveBeenCalledWith('node-1', 'api');
    expect(environmentService.seedFromRuntimeIfMissing).not.toHaveBeenCalled();
  });

  it('filters secret keys before seeding missing stored environment from runtime env', async () => {
    const dispatch = {
      sendDockerContainerCommand: vi.fn().mockResolvedValue(inspectResult(['PUBLIC=1', 'SECRET=hidden', 'NO_EQUALS'])),
    };
    const secretService = {
      getSecretKeys: vi.fn().mockResolvedValue(new Set(['SECRET'])),
    };
    const environmentService = {
      getDecryptedMap: vi.fn().mockResolvedValue({}),
      seedFromRuntimeIfMissing: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(dispatch);
    service.setSecretService(secretService as never);
    service.setEnvironmentService(environmentService as never);

    await expect(service.getContainerEnv('node-1', 'container-1')).resolves.toEqual(['PUBLIC=1', 'NO_EQUALS']);
    expect(secretService.getSecretKeys).toHaveBeenCalledWith('node-1', 'api');
    expect(environmentService.seedFromRuntimeIfMissing).toHaveBeenCalledWith('node-1', 'api', {
      PUBLIC: '1',
      NO_EQUALS: '',
    });
  });
});
