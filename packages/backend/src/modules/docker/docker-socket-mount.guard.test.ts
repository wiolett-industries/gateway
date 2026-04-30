import { describe, expect, it } from 'vitest';
import { assertNoDockerSocketMountsInConfig, isDangerousDockerSocketPath } from './docker-socket-mount.guard.js';

describe('Docker socket mount guard', () => {
  it('detects Docker-compatible daemon socket paths', () => {
    expect(isDangerousDockerSocketPath('/var/run/docker.sock')).toBe(true);
    expect(isDangerousDockerSocketPath('/run/snap.docker/dockerd.sock')).toBe(true);
    expect(isDangerousDockerSocketPath('/run/containerd/containerd.sock')).toBe(true);
    expect(isDangerousDockerSocketPath('/var/snap/docker/current/run/dockerd.sock')).toBe(true);
    expect(isDangerousDockerSocketPath('/srv/app/data.sock')).toBe(false);
  });

  it('detects ancestors and descendants of daemon socket directories', () => {
    expect(isDangerousDockerSocketPath('/var/snap/docker')).toBe(true);
    expect(isDangerousDockerSocketPath('/var/snap/docker/current')).toBe(true);
    expect(isDangerousDockerSocketPath('/var/snap/docker/current/run')).toBe(true);
    expect(isDangerousDockerSocketPath('/var/snap/docker/current/run/private')).toBe(true);
    expect(isDangerousDockerSocketPath('/run/containerd')).toBe(true);
  });

  it('allows ordinary descendants of broad runtime directories', () => {
    expect(isDangerousDockerSocketPath('/run/secrets')).toBe(false);
    expect(isDangerousDockerSocketPath('/run/app/app.sock')).toBe(false);
    expect(isDangerousDockerSocketPath('/run/docker-data')).toBe(false);
    expect(isDangerousDockerSocketPath('/var/run/app')).toBe(false);
  });

  it('rejects container create and recreate mount configs that expose daemon sockets', () => {
    expect(() =>
      assertNoDockerSocketMountsInConfig({
        mounts: [{ hostPath: '/run/snap.docker/dockerd.sock', containerPath: '/docker.sock' }],
      })
    ).toThrowError(/daemon sockets/);
  });

  it('checks volumes even when mounts are also present', () => {
    expect(() =>
      assertNoDockerSocketMountsInConfig({
        mounts: [{ hostPath: '/srv/app/config', containerPath: '/config' }],
        volumes: [{ hostPath: '/var/run/docker.sock', containerPath: '/docker.sock' }],
      })
    ).toThrowError(/daemon sockets/);
  });

  it('allows named volumes and ordinary host binds', () => {
    expect(() =>
      assertNoDockerSocketMountsInConfig({
        volumes: [
          { name: 'app-data', containerPath: '/data' },
          { hostPath: '/srv/app/config', containerPath: '/config', readOnly: true },
        ],
      })
    ).not.toThrow();
  });
});
