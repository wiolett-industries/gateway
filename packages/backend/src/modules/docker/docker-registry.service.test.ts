import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerRegistryService } from './docker-registry.service.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createSavedRegistryConnectionService(rowOverride: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: 'registry-1',
    name: 'Registry',
    url: 'https://registry.example.com',
    username: 'user',
    encryptedPassword: '{}',
    trustedAuthRealm: null,
    scope: 'global',
    nodeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rowOverride,
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([row]),
        })),
      })),
    })),
  };

  return new DockerRegistryService(
    db as never,
    {} as never,
    { decryptString: vi.fn().mockReturnValue('password') } as never,
    {} as never
  );
}

describe('DockerRegistryService image registry mappings', () => {
  function createService(mappingRegistryId = 'team-registry') {
    const registries = [
      {
        id: 'generic-registry',
        name: 'Generic',
        url: 'https://registry.example.com',
        username: 'generic',
        encryptedPassword: '{}',
        trustedAuthRealm: null,
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
        trustedAuthRealm: null,
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

describe('DockerRegistryService connection tests', () => {
  it('does not forward saved registry credentials to a cross-host bearer realm', async () => {
    const service = createSavedRegistryConnectionService();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://evil.example.net/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnection('registry-1');

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/v2/',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });

  it('allows saved registry token exchange to a same-host https bearer realm', async () => {
    const service = createSavedRegistryConnectionService();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="https://registry.example.com/token",service="registry.example.com"',
          },
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnection('registry-1');

    expect(result).toEqual({ success: true, status: 200, statusText: 'Authenticated (token exchange)' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://registry.example.com/token?service=registry.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });

  it('does not forward direct test credentials to a cross-host bearer realm', async () => {
    const service = createSavedRegistryConnectionService();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://evil.example.net/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnectionDirect('https://registry.example.com', 'user', 'password');

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows saved registry token exchange to an explicitly trusted https realm origin', async () => {
    const service = createSavedRegistryConnectionService({ trustedAuthRealm: 'https://auth.registry.example.net' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="https://auth.registry.example.net/token",service="registry.example.com"',
          },
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnection('registry-1');

    expect(result).toEqual({ success: true, status: 200, statusText: 'Authenticated (token exchange)' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.registry.example.net/token?service=registry.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });

  it('allows direct token exchange only when the trusted realm origin matches exactly', async () => {
    const service = createSavedRegistryConnectionService();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://auth.registry.example.net/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnectionDirect(
      'https://registry.example.com',
      'user',
      'password',
      'https://other.registry.example.net'
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat non-https trusted realm origins as trusted', async () => {
    const service = createSavedRegistryConnectionService({ trustedAuthRealm: 'http://auth.registry.example.net' });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://auth.registry.example.net/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnection('registry-1');

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not forward credentials to a same-host http bearer realm', async () => {
    const service = createSavedRegistryConnectionService();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="http://registry.example.com/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnectionDirect('https://registry.example.com', 'user', 'password');

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not forward credentials to a bearer realm on a different port', async () => {
    const service = createSavedRegistryConnectionService({ url: 'https://registry.example.com:5000' });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://registry.example.com/token",service="registry.example.com"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.testConnection('registry-1');

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toContain('Bearer realm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
