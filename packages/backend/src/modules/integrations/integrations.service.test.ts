import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '@/middleware/error-handler.js';
import { IntegrationsService } from './integrations.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [] as string[],
  isBlocked: false,
};

function connectorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'gitlab',
    name: 'Main GitLab',
    baseUrl: 'https://gitlab.example.com',
    enabled: true,
    encryptedToken: 'encrypted-token',
    tokenLast4: 'abcd',
    allowlistMode: 'selected',
    settings: {
      autoSyncEnabled: true,
      autoSyncIntervalSeconds: 900,
      cloneShallow: true,
      cloneDepth: 1,
      cloneLfs: false,
      cloneSubmodules: false,
      cloneMaxSizeMb: 1024,
      cloneTimeoutSeconds: 300,
    },
    capabilities: { projectsView: true },
    syncStatus: 'never',
    syncLastError: null,
    syncFailureCount: 0,
    syncStartedAt: null,
    syncFinishedAt: null,
    syncLastOverlapAt: null,
    syncNextRetryAt: null,
    testedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createListDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  };
}

function createGetDb(row: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([row]),
        })),
      })),
    })),
  };
}

function createGetUpdateDb(row: unknown) {
  return {
    ...createGetDb(row),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
}

function createToolProjectsDb(input: { connector: unknown; projects: unknown[]; allowlistEntries: unknown[] }) {
  const select = vi.fn();
  select
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([input.connector]),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(input.projects),
          })),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue(input.allowlistEntries),
        })),
      })),
    });
  return { select };
}

describe('IntegrationsService', () => {
  it('strips encrypted tokens and returns masked token metadata in list responses', async () => {
    const db = createListDb([connectorRow()]);
    const service = new IntegrationsService(db as never, { log: vi.fn() } as never, {} as never);

    const [connector] = await service.listGitLabConnectors();

    expect(connector).toMatchObject({ hasToken: true, tokenMasked: '****abcd' });
    expect(connector).not.toHaveProperty('encryptedToken');
  });

  it('returns stored capabilities without decrypting the token', async () => {
    const db = createGetDb(connectorRow({ capabilities: { repoRead: true, repoWrite: false } }));
    const service = new IntegrationsService(db as never, { log: vi.fn() } as never, {} as never);

    await expect(service.getGitLabConnectorCapabilities('11111111-1111-4111-8111-111111111111')).resolves.toEqual({
      repoRead: true,
      repoWrite: false,
    });
  });

  it('rejects malformed connector IDs before querying the database', async () => {
    const db = createGetDb(connectorRow());
    const service = new IntegrationsService(db as never, { log: vi.fn() } as never, {} as never);

    await expect(service.listGitLabProjectsForTool(BASE_USER, { connectorId: 'connector-1' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_CONNECTOR_ID',
    } satisfies Partial<AppError>);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('lists only allowlisted GitLab projects for AI tools', async () => {
    const db = createToolProjectsDb({
      connector: connectorRow(),
      projects: [
        {
          connectorId: '11111111-1111-4111-8111-111111111111',
          remoteId: '10',
          fullPath: 'helmut/link4work',
          name: 'link4work',
          webUrl: 'https://gitlab.example.com/helmut/link4work',
          visibility: 'private',
          defaultBranch: 'main',
          archived: false,
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
          inaccessibleAt: null,
          metadata: {},
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          connectorId: '11111111-1111-4111-8111-111111111111',
          remoteId: '11',
          fullPath: 'allowed/app',
          name: 'app',
          webUrl: 'https://gitlab.example.com/allowed/app',
          visibility: 'private',
          defaultBranch: 'main',
          archived: false,
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
          inaccessibleAt: null,
          metadata: {},
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      allowlistEntries: [{ entryType: 'project', remoteId: '11', fullPath: 'allowed/app', name: null, webUrl: null }],
    });
    const auditService = { log: vi.fn() };
    const service = new IntegrationsService(db as never, auditService as never, {} as never);

    const result = await service.listGitLabProjectsForTool(
      { ...BASE_USER, scopes: ['integrations:gitlab:projects:view'] },
      { connectorId: '11111111-1111-4111-8111-111111111111', search: 'link', limit: 10 }
    );

    expect(result).toMatchObject({ data: [], total: 0, truncated: false });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          returned: 0,
          totalMatched: 0,
        }),
      })
    );
  });

  it('does not fake provider-backed actions before a provider is registered', async () => {
    const db = createGetDb(connectorRow());
    const service = new IntegrationsService(db as never, { log: vi.fn() } as never, {} as never);

    await expect(service.testGitLabConnector('11111111-1111-4111-8111-111111111111', 'user-1')).rejects.toMatchObject({
      statusCode: 501,
      code: 'CONNECTOR_PROVIDER_UNAVAILABLE',
    } satisfies Partial<AppError>);
  });

  it('allows selected GitLab projects by exact project or parent group allowlist', () => {
    const service = new IntegrationsService({} as never, { log: vi.fn() } as never, {} as never);
    const allowlist = [
      { entryType: 'project', remoteId: '10', fullPath: 'other/app', name: null, webUrl: null },
      { entryType: 'group', remoteId: '20', fullPath: 'org/platform', name: null, webUrl: null },
    ] as never;

    expect(service.isGitLabProjectAllowed({ remoteId: '10', fullPath: 'unrelated/path', name: 'app' }, allowlist)).toBe(
      true
    );
    expect(
      service.isGitLabProjectAllowed({ remoteId: '11', fullPath: 'org/platform/api', name: 'api' }, allowlist)
    ).toBe(true);
    expect(service.isGitLabProjectAllowed({ remoteId: '12', fullPath: 'org/other', name: 'other' }, allowlist)).toBe(
      false
    );
  });

  it('rejects manual sync while a connector sync is already running', async () => {
    const db = createGetUpdateDb(connectorRow({ syncStatus: 'running', syncStartedAt: new Date(Date.now() - 1000) }));
    const service = new IntegrationsService(db as never, { log: vi.fn() } as never, {} as never);

    await expect(service.syncGitLabConnector('11111111-1111-4111-8111-111111111111', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONNECTOR_SYNC_RUNNING',
    });
  });
});
