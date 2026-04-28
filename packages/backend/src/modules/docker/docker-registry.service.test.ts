import { describe, expect, it, vi } from 'vitest';
import { DockerRegistryService } from './docker-registry.service.js';

describe('DockerRegistryService image registry mappings', () => {
  function createService(mappingRegistryId = 'team-registry') {
    const registries = [
      {
        id: 'generic-registry',
        name: 'Generic',
        url: 'https://registry.example.com',
        username: 'generic',
        encryptedPassword: '{}',
        scope: 'global',
        nodeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'team-registry',
        name: 'Team',
        url: 'https://registry.example.com',
        username: 'team',
        encryptedPassword: '{}',
        scope: 'global',
        nodeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => {
        if (selection?.registryId) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ registryId: mappingRegistryId }]),
              })),
            })),
          };
        }

        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(registries),
          })),
        };
      }),
    };
    const service = new DockerRegistryService(
      db as never,
      {} as never,
      { decryptString: vi.fn().mockReturnValue('password') } as never,
      {} as never
    );

    return service;
  }

  it('prefers a learned image repository mapping before same-host registry fallback candidates', async () => {
    const service = createService();

    const candidates = await service.resolveAuthCandidatesForImagePull('node-1', 'registry.example.com/team/app:new');

    expect(candidates.map((candidate) => candidate.registryId)).toEqual(['team-registry', 'generic-registry']);
  });

  it('uses a learned mapping for unqualified image repositories', async () => {
    const service = createService();

    const candidates = await service.resolveAuthCandidatesForImagePull('node-1', 'team/app:new');

    expect(candidates.map((candidate) => candidate.registryId)).toEqual(['team-registry']);
    expect(candidates[0]?.url).toBe('registry.example.com');
  });
});
