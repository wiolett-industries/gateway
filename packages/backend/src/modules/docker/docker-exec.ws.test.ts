import { describe, expect, it, vi } from 'vitest';
import { resolveDockerExecUser } from './docker-exec.ws.js';

describe('resolveDockerExecUser', () => {
  it('uses the configured container execution user when present', async () => {
    const docker = {
      inspectContainer: vi.fn().mockResolvedValue({ Config: { User: 'node' } }),
    };

    await expect(resolveDockerExecUser(docker as never, 'node-1', 'container-1')).resolves.toBe('node');
    expect(docker.inspectContainer).toHaveBeenCalledWith('node-1', 'container-1');
  });

  it('preserves uid and gid execution user values', async () => {
    const docker = {
      inspectContainer: vi.fn().mockResolvedValue({ Config: { User: '1000:1000' } }),
    };

    await expect(resolveDockerExecUser(docker as never, 'node-1', 'container-1')).resolves.toBe('1000:1000');
  });

  it('defaults to root when the container has no configured execution user', async () => {
    const docker = {
      inspectContainer: vi.fn().mockResolvedValue({ Config: { User: '' } }),
    };

    await expect(resolveDockerExecUser(docker as never, 'node-1', 'container-1')).resolves.toBe('root');
  });

  it('defaults to root when the container cannot be inspected', async () => {
    const docker = {
      inspectContainer: vi.fn().mockRejectedValue(new Error('inspect failed')),
    };

    await expect(resolveDockerExecUser(docker as never, 'node-1', 'container-1')).resolves.toBe('root');
  });
});
