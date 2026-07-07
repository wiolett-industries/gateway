import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const FD_ROOT = '/proc/self/fd';

function assertInsideRoot(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('artifact path must stay inside /workspace');
  }
}

function fdChildPath(parent: fs.FileHandle, segment: string): string {
  return `${FD_ROOT}/${parent.fd}/${segment}`;
}

function symlinkPathError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ELOOP';
  return error;
}

async function isSymlink(pathname: string): Promise<boolean> {
  return fs
    .lstat(pathname)
    .then((entry) => entry.isSymbolicLink())
    .catch(() => false);
}

async function fdRootAvailable(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  return fs
    .access(FD_ROOT)
    .then(() => true)
    .catch(() => false);
}

export async function supportsFdRelativeArtifactOpen(): Promise<boolean> {
  return fdRootAvailable();
}

export interface HostArtifactPath {
  path: string;
  rootPath: string;
  parentPath: string;
  parentSegments: string[];
  filename: string;
}

type DirectoryPathAccess = (directoryPath: string) => Promise<void>;
type DirectoryHandleAccess = (directory: fs.FileHandle) => Promise<void>;

function artifactPathSegments(relativePath: string): { segments: string[]; filename: string } {
  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.');
  const filename = segments.pop();
  if (!filename || filename === '..' || segments.includes('..')) {
    throw new Error('artifact path must stay inside /workspace');
  }
  return { segments, filename };
}

export async function resolveHostArtifactPath(
  workspaceDir: string,
  relativePath: string,
  allowDirectoryAccess: DirectoryPathAccess = async () => undefined,
  allowDirectoryHandleAccess: DirectoryHandleAccess = async () => undefined
): Promise<HostArtifactPath> {
  const root = await fs.realpath(workspaceDir);
  const { segments, filename } = artifactPathSegments(relativePath);

  if (await fdRootAvailable()) {
    return resolveHostArtifactPathViaFd(root, segments, filename, allowDirectoryHandleAccess);
  }

  return resolveHostArtifactPathByPath(root, segments, filename, allowDirectoryAccess);
}

async function resolveHostArtifactPathByPath(
  root: string,
  segments: string[],
  filename: string,
  allowDirectoryAccess: DirectoryPathAccess
): Promise<HostArtifactPath> {
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
  return { path: hostPath, rootPath: root, parentPath: realParent, parentSegments: segments, filename };
}

async function openChildDirectory(parent: fs.FileHandle, segment: string): Promise<fs.FileHandle> {
  try {
    return await fs.open(
      fdChildPath(parent, segment),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ELOOP') throw symlinkPathError('artifact path must not contain symbolic links');
    if (err.code === 'ENOTDIR') {
      if (await isSymlink(fdChildPath(parent, segment))) {
        throw symlinkPathError('artifact path must not contain symbolic links');
      }
      throw new Error('artifact path parent must be a directory');
    }
    throw error;
  }
}

async function resolveHostArtifactPathViaFd(
  root: string,
  segments: string[],
  filename: string,
  allowDirectoryHandleAccess: DirectoryHandleAccess
): Promise<HostArtifactPath> {
  let current = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let currentPath = root;
  try {
    for (const segment of segments) {
      let created = false;
      const next = await openChildDirectory(current, segment).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        await fs.mkdir(fdChildPath(current, segment), { mode: 0o700 });
        created = true;
        return openChildDirectory(current, segment);
      });
      const previous = current;
      current = next;
      currentPath = path.join(currentPath, segment);
      if (created) await allowDirectoryHandleAccess(current);
      await previous.close().catch(() => {});
    }

    await allowDirectoryHandleAccess(current);
    const existing = await fs.lstat(fdChildPath(current, filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) {
      throw new Error('artifact path must not be a symbolic link');
    }

    await current.close().catch(() => {});
    return {
      path: path.join(currentPath, filename),
      rootPath: root,
      parentPath: currentPath,
      parentSegments: segments,
      filename,
    };
  } catch (error) {
    await current.close().catch(() => {});
    throw error;
  }
}

async function openHostArtifactViaFd(artifact: HostArtifactPath, flags: number, mode?: number): Promise<fs.FileHandle> {
  let current = await fs.open(artifact.rootPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const segment of artifact.parentSegments) {
      const previous = current;
      const next = await openChildDirectory(previous, segment);
      current = next;
      await previous.close().catch(() => {});
    }

    const file = await fs.open(fdChildPath(current, artifact.filename), flags | constants.O_NOFOLLOW, mode);
    await current.close().catch(() => {});
    return file;
  } catch (error) {
    await current.close().catch(() => {});
    throw error;
  }
}

export async function openHostArtifact(
  artifact: HostArtifactPath,
  flags: number,
  mode?: number
): Promise<fs.FileHandle> {
  if (await fdRootAvailable()) return openHostArtifactViaFd(artifact, flags, mode);
  throw new Error(`secure artifact access requires ${FD_ROOT}`);
}
