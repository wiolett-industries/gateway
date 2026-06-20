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
  sendDockerVolumeCommand?: ReturnType<typeof vi.fn>;
  sendDockerNetworkCommand?: ReturnType<typeof vi.fn>;
}) {
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new DockerManagementService(
    dbWithOnlineDockerNode() as never,
    audit as never,
    dispatch as never,
    { getNode: vi.fn().mockReturnValue({ id: 'node-1' }) } as never
  );
  const eventBus = { publish: vi.fn() };
  service.setEventBus(eventBus as never);
  return { service, audit, eventBus };
}

describe('DockerManagementService volume and network operations', () => {
  it('creates volumes with audit and volume change events', async () => {
    const dispatch = {
      sendDockerVolumeCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify({ Name: 'data' }),
      }),
    };
    const { service, audit, eventBus } = createService(dispatch);

    await expect(service.createVolume('node-1', { name: 'data', driver: 'local' }, 'user-1')).resolves.toEqual({
      Name: 'data',
    });

    expect(dispatch.sendDockerVolumeCommand).toHaveBeenCalledWith('node-1', 'create', {
      name: 'data',
      driver: 'local',
    });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'docker.volume.create',
      userId: 'user-1',
      resourceType: 'docker-volume',
      details: { nodeId: 'node-1', name: 'data' },
    });
    expect(eventBus.publish).toHaveBeenCalledWith('docker.volume.changed', {
      nodeId: 'node-1',
      name: 'data',
      action: 'created',
    });
  });

  it('removes volumes with force flag, audit, and change events', async () => {
    const dispatch = {
      sendDockerVolumeCommand: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service, audit, eventBus } = createService(dispatch);

    await service.removeVolume('node-1', 'data', true, 'user-1');

    expect(dispatch.sendDockerVolumeCommand).toHaveBeenCalledWith('node-1', 'remove', {
      name: 'data',
      force: true,
    });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'docker.volume.remove',
      userId: 'user-1',
      resourceType: 'docker-volume',
      resourceId: 'data',
      details: { nodeId: 'node-1' },
    });
    expect(eventBus.publish).toHaveBeenCalledWith('docker.volume.changed', {
      nodeId: 'node-1',
      name: 'data',
      action: 'removed',
    });
  });

  it('creates networks with daemon field mapping, audit, and change events', async () => {
    const dispatch = {
      sendDockerNetworkCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify({ Id: 'network-1' }),
      }),
    };
    const { service, audit, eventBus } = createService(dispatch);

    await expect(
      service.createNetwork(
        'node-1',
        { name: 'frontend', driver: 'bridge', subnet: '10.10.0.0/24', gateway: '10.10.0.1' },
        'user-1'
      )
    ).resolves.toEqual({ Id: 'network-1' });

    expect(dispatch.sendDockerNetworkCommand).toHaveBeenCalledWith('node-1', 'create', {
      networkId: 'frontend',
      driver: 'bridge',
      subnet: '10.10.0.0/24',
      gatewayAddr: '10.10.0.1',
    });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'docker.network.create',
      userId: 'user-1',
      resourceType: 'docker-network',
      details: { nodeId: 'node-1', name: 'frontend' },
    });
    expect(eventBus.publish).toHaveBeenCalledWith('docker.network.changed', {
      nodeId: 'node-1',
      name: 'frontend',
      action: 'created',
    });
  });

  it('rejects removing built-in networks after resolving network names', async () => {
    const dispatch = {
      sendDockerNetworkCommand: vi.fn(async (_nodeId: string, action: string) => {
        if (action === 'list') {
          return { success: true, detail: JSON.stringify([{ Id: 'builtin-1', Name: 'bridge' }]) };
        }
        return { success: true };
      }),
    };
    const { service } = createService(dispatch);

    await expect(service.removeNetwork('node-1', 'builtin-1', 'user-1')).rejects.toMatchObject({
      statusCode: 400,
      code: 'BUILTIN_NETWORK',
    });
    expect(dispatch.sendDockerNetworkCommand).not.toHaveBeenCalledWith('node-1', 'remove', expect.anything());
  });

  it('disconnects containers from custom networks with audit', async () => {
    const dispatch = {
      sendDockerNetworkCommand: vi.fn(async (_nodeId: string, action: string) => {
        if (action === 'list') {
          return { success: true, detail: JSON.stringify([{ Id: 'custom-1', Name: 'frontend' }]) };
        }
        return { success: true };
      }),
    };
    const { service, audit } = createService(dispatch);

    await service.disconnectContainerFromNetwork('node-1', 'custom-1', 'container-1', 'user-1');

    expect(dispatch.sendDockerNetworkCommand).toHaveBeenCalledWith('node-1', 'disconnect', {
      networkId: 'custom-1',
      containerId: 'container-1',
    });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'docker.network.disconnect',
      userId: 'user-1',
      resourceType: 'docker-network',
      resourceId: 'custom-1',
      details: { nodeId: 'node-1', containerId: 'container-1' },
    });
  });
});
