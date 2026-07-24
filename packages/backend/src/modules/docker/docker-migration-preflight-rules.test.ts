import { describe, expect, it } from 'vitest';
import {
  allowedSourceConsumers,
  hasImageTagCollision,
  isVersionOlder,
  migrationSourceHostPorts,
  migrationTargetHostPorts,
  migrationTargetNames,
  portableNetworkShape,
} from './docker-migration-preflight-rules.js';

describe('Docker migration preflight collision rules', () => {
  it('includes deployment router and slots in target identities', () => {
    expect(
      migrationTargetNames('api', {
        routerName: 'gw-router',
        slots: [{ containerName: 'gw-blue' }, { containerName: 'gw-green' }],
      })
    ).toEqual(['api', 'gw-router', 'gw-blue', 'gw-green']);
  });

  it('detects standalone and deployment host-port collisions', () => {
    expect(
      migrationSourceHostPorts(
        { HostConfig: { PortBindings: { '8080/tcp': [{ HostPort: '8443' }] } } },
        { routes: [{ hostPort: 9443 }] }
      )
    ).toEqual([8443, 9443]);
    expect(migrationTargetHostPorts([{ Ports: [{ PublicPort: 8443 }] }])).toEqual(new Set([8443]));
  });

  it('compares only portable network creation properties', () => {
    const left = portableNetworkShape({
      Driver: 'bridge',
      Internal: false,
      IPAM: { Driver: 'default', Config: [{ Subnet: '10.40.0.0/24' }] },
      Id: 'runtime-source-id',
    });
    const right = portableNetworkShape({
      Driver: 'bridge',
      Internal: false,
      IPAM: { Driver: 'default', Config: [{ Subnet: '10.40.0.0/24' }] },
      Id: 'runtime-target-id',
    });
    expect(left).toBe(right);
  });

  it('blocks a target tag that resolves to another image digest', () => {
    const source = { Image: 'sha256:source', Config: { Image: 'registry.example/api:latest' } };
    expect(hasImageTagCollision(source, [{ Id: 'sha256:target', RepoTags: ['registry.example/api:latest'] }])).toBe(
      true
    );
    expect(hasImageTagCollision(source, [{ Id: 'sha256:source', RepoTags: ['registry.example/api:latest'] }])).toBe(
      false
    );
  });

  it('allows only source resource consumers during volume checks', () => {
    expect(
      allowedSourceConsumers(
        { Id: 'container-id', Name: '/api' },
        { routerName: 'gw-router', slots: [{ containerId: 'blue-id', containerName: 'gw-blue' }] }
      )
    ).toEqual(new Set(['container-id', 'api', 'gw-router', 'blue-id', 'gw-blue']));
  });

  it('compares Docker engine and API versions numerically', () => {
    expect(isVersionOlder('1.46', '1.45')).toBe(false);
    expect(isVersionOlder('1.44', '1.45')).toBe(true);
    expect(isVersionOlder(undefined, '1.45')).toBeNull();
  });
});
