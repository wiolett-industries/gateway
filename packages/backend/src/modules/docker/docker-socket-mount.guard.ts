import path from 'node:path';
import { AppError } from '@/middleware/error-handler.js';

type DockerMountInput = {
  hostPath?: string | null;
  containerPath?: string | null;
  name?: string | null;
  readOnly?: boolean | null;
};

const SOCKET_TOKENS = ['docker', 'dockerd', 'containerd', 'cri-dockerd', 'podman', 'nerdctl', 'buildkit', 'buildkitd'];
const DANGEROUS_SOCKET_DIRS_EXACT = new Set(['/var/run', '/run']);
const DANGEROUS_SOCKET_ROOTS = new Set(['/run/docker', '/run/containerd', '/run/snap.docker', '/var/snap/docker']);

function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return path.posix.normalize(trimmed.replaceAll('\\', '/'));
}

export function isDangerousDockerSocketPath(input: string | null | undefined): boolean {
  if (!input) return false;
  const normalized = normalizePath(input);
  if (!normalized.startsWith('/')) return false;

  const lower = normalized.toLowerCase();
  if (DANGEROUS_SOCKET_DIRS_EXACT.has(lower)) return true;
  for (const dangerousRoot of DANGEROUS_SOCKET_ROOTS) {
    if (lower === dangerousRoot || lower.startsWith(`${dangerousRoot}/`)) {
      return true;
    }
  }

  const basename = path.posix.basename(lower);
  if (!basename.endsWith('.sock')) return false;

  return SOCKET_TOKENS.some((token) => basename.includes(token));
}

export function assertNoDockerSocketMounts(mounts: DockerMountInput[] | undefined): void {
  for (const mount of mounts ?? []) {
    if (isDangerousDockerSocketPath(mount.hostPath)) {
      throw new AppError(
        400,
        'DOCKER_SOCKET_MOUNT_FORBIDDEN',
        'Mounting Docker, containerd, or compatible daemon sockets into containers is not allowed'
      );
    }
  }
}

export function assertNoDockerSocketMountsInConfig(config: {
  mounts?: DockerMountInput[];
  volumes?: DockerMountInput[];
}): void {
  assertNoDockerSocketMounts(config.mounts);
  assertNoDockerSocketMounts(config.volumes);
}
