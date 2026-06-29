import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHostArtifactPath } from './artifact-path.js';

let tempDir: string;
let workspaceDir: string;
let outsideDir: string;

describe('sandbox artifact host path resolution', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gateway-sandbox-artifact-path-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    outsideDir = path.join(tempDir, 'outside');
    await Promise.all([mkdir(workspaceDir), mkdir(outsideDir)]);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates normal nested artifact parent directories inside the workspace', async () => {
    const allowDirectoryAccess = vi.fn().mockResolvedValue(undefined);
    const realWorkspaceDir = await realpath(workspaceDir);

    await expect(resolveHostArtifactPath(workspaceDir, 'artifacts/nested/result.txt', allowDirectoryAccess)).resolves.toBe(
      path.join(realWorkspaceDir, 'artifacts', 'nested', 'result.txt')
    );
    expect(allowDirectoryAccess).toHaveBeenCalledWith(path.join(realWorkspaceDir, 'artifacts', 'nested'));
  });

  it('rejects symlink parent components before creating directories through them', async () => {
    await symlink(outsideDir, path.join(workspaceDir, 'link'), 'dir');

    await expect(resolveHostArtifactPath(workspaceDir, 'link/new/result.txt')).rejects.toThrow('symbolic links');
    await expect(stat(path.join(outsideDir, 'new'))).rejects.toThrow();
  });

  it('rejects an artifact target that is a symbolic link', async () => {
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'secret');
    await symlink(outsideFile, path.join(workspaceDir, 'result.txt'));

    await expect(resolveHostArtifactPath(workspaceDir, 'result.txt')).rejects.toThrow('symbolic link');
  });
});
