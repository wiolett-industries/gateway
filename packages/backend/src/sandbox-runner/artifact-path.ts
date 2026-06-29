import fs from 'node:fs/promises';
import path from 'node:path';

function assertInsideRoot(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('artifact path must stay inside /workspace');
  }
}

export async function resolveHostArtifactPath(
  workspaceDir: string,
  relativePath: string,
  allowDirectoryAccess: (directoryPath: string) => Promise<void> = async () => undefined
): Promise<string> {
  const root = await fs.realpath(workspaceDir);
  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.');
  const filename = segments.pop();
  if (!filename || filename === '..' || segments.includes('..')) {
    throw new Error('artifact path must stay inside /workspace');
  }

  let current = root;
  for (const segment of segments) {
    const next = path.join(current, segment);
    const existing = await fs.lstat(next).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      if (existing.isSymbolicLink()) throw new Error('artifact path must not contain symbolic links');
      if (!existing.isDirectory()) throw new Error('artifact path parent must be a directory');
      assertInsideRoot(root, await fs.realpath(next));
    } else {
      await fs.mkdir(next, { mode: 0o700 });
    }
    current = next;
  }

  const realParent = await fs.realpath(current);
  assertInsideRoot(root, realParent);
  await allowDirectoryAccess(realParent);

  const hostPath = path.join(realParent, filename);
  const existing = await fs.lstat(hostPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error('artifact path must not be a symbolic link');
  }
  return hostPath;
}
