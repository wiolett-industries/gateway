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
  sendDockerContainerCommand?: ReturnType<typeof vi.fn>;
  sendDockerFileCommand?: ReturnType<typeof vi.fn>;
  sendDockerLogsCommand?: ReturnType<typeof vi.fn>;
}) {
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new DockerManagementService(
    dbWithOnlineDockerNode() as never,
    audit as never,
    dispatch as never,
    { getNode: vi.fn().mockReturnValue({ id: 'node-1' }) } as never
  );
  return { service, audit };
}

describe('DockerManagementService read and file operations', () => {
  it('clamps log tail requests before dispatching', async () => {
    const dispatch = {
      sendDockerLogsCommand: vi.fn().mockResolvedValue({
        success: true,
        detail: JSON.stringify(['line-1']),
      }),
    };
    const { service } = createService(dispatch);

    await expect(service.getContainerLogs('node-1', 'container-1', 999999, true)).resolves.toEqual(['line-1']);
    expect(dispatch.sendDockerLogsCommand).toHaveBeenCalledWith('node-1', 'container-1', {
      tailLines: 1000,
      timestamps: true,
    });
  });

  it('routes stats and top requests through container commands', async () => {
    const dispatch = {
      sendDockerContainerCommand: vi
        .fn()
        .mockResolvedValueOnce({ success: true, detail: JSON.stringify({ cpu: 12 }) })
        .mockResolvedValueOnce({ success: true, detail: JSON.stringify({ processes: ['node'] }) }),
    };
    const { service } = createService(dispatch);

    await expect(service.getContainerStats('node-1', 'container-1')).resolves.toEqual({ cpu: 12 });
    await expect(service.getContainerTop('node-1', 'container-1')).resolves.toEqual({ processes: ['node'] });
    expect(dispatch.sendDockerContainerCommand).toHaveBeenNthCalledWith(1, 'node-1', 'stats', {
      containerId: 'container-1',
    });
    expect(dispatch.sendDockerContainerCommand).toHaveBeenNthCalledWith(2, 'node-1', 'top', {
      containerId: 'container-1',
    });
  });

  it('routes file browse reads with the existing max read size', async () => {
    const dispatch = {
      sendDockerFileCommand: vi
        .fn()
        .mockResolvedValueOnce({ success: true, detail: JSON.stringify([{ name: 'app.log' }]) })
        .mockResolvedValueOnce({ success: true, detail: JSON.stringify({ content: 'hello' }) }),
    };
    const { service } = createService(dispatch);

    await expect(service.listDirectory('node-1', 'container-1', '/var/log')).resolves.toEqual([{ name: 'app.log' }]);
    await expect(service.readFile('node-1', 'container-1', '/var/log/app.log')).resolves.toEqual({
      content: 'hello',
    });
    expect(dispatch.sendDockerFileCommand).toHaveBeenNthCalledWith(1, 'node-1', 'list', {
      containerId: 'container-1',
      path: '/var/log',
    });
    expect(dispatch.sendDockerFileCommand).toHaveBeenNthCalledWith(2, 'node-1', 'read', {
      containerId: 'container-1',
      path: '/var/log/app.log',
      maxBytes: 1048576,
    });
  });

  it('writes files and records an audit event', async () => {
    const dispatch = {
      sendDockerFileCommand: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service, audit } = createService(dispatch);

    await service.writeFile('node-1', 'container-1', '/etc/app.conf', 'enabled=true', 'user-1');

    expect(dispatch.sendDockerFileCommand).toHaveBeenCalledWith('node-1', 'write', {
      containerId: 'container-1',
      path: '/etc/app.conf',
      content: 'enabled=true',
    });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'docker.file.write',
      userId: 'user-1',
      resourceType: 'docker-container',
      resourceId: 'container-1',
      details: { nodeId: 'node-1', path: '/etc/app.conf' },
    });
  });
});
