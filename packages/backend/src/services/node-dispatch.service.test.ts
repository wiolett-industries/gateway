import { describe, expect, it, vi } from 'vitest';
import { NodeDispatchService } from './node-dispatch.service.js';

function createService() {
  const registry = {
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
  };
  const service = new NodeDispatchService(registry as never, {} as never);
  return { registry, service };
}

describe('NodeDispatchService', () => {
  it('forwards per-user session keys for Docker and node consoles', async () => {
    const { registry, service } = createService();

    await service.sendDockerExecCommand('node-1', 'create', {
      containerId: 'container-1',
      sessionKey: 'user-1',
    });
    await service.sendNodeExecCommand('node-1', 'create', {
      sessionKey: 'user-1',
    });

    expect(registry.sendCommand).toHaveBeenNthCalledWith(
      1,
      'node-1',
      {
        dockerExec: {
          action: 'create',
          containerId: 'container-1',
          sessionKey: 'user-1',
        },
      },
      undefined,
    );
    expect(registry.sendCommand).toHaveBeenNthCalledWith(
      2,
      'node-1',
      {
        nodeExec: {
          action: 'create',
          sessionKey: 'user-1',
        },
      },
      undefined,
    );
  });

  it('sends docker file string content as UTF-8 bytes', async () => {
    const { registry, service } = createService();

    await service.sendDockerFileCommand('node-1', 'write', {
      containerId: 'container-1',
      path: '/tmp/file.txt',
      content: 'Hello',
    });

    expect(registry.sendCommand).toHaveBeenCalledWith('node-1', {
      dockerFile: {
        action: 'write',
        containerId: 'container-1',
        path: '/tmp/file.txt',
        content: Buffer.from('Hello'),
      },
    });
  });

  it('passes docker file buffer content through unchanged', async () => {
    const { registry, service } = createService();
    const content = Buffer.from([0, 1, 2, 3]);

    await service.sendDockerFileCommand('node-1', 'write', {
      containerId: 'container-1',
      path: '/tmp/file.bin',
      content,
    });

    expect(registry.sendCommand).toHaveBeenCalledWith('node-1', {
      dockerFile: {
        action: 'write',
        containerId: 'container-1',
        path: '/tmp/file.bin',
        content,
      },
    });
  });
});
