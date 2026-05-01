import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { oauthAccessTokens, oauthAuthorizationCodes, oauthRefreshTokens } from '@/db/schema/index.js';
import type { User } from '@/types.js';
import { OAuthService } from './oauth.service.js';

vi.mock('@/config/env.js', () => ({
  getEnv: () => ({
    APP_URL: 'https://gateway.example.com',
  }),
}));

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['mcp:use', 'nodes:details', 'nodes:details:node-1'],
  isBlocked: false,
};

function createService(options?: {
  refreshToken?: any;
  refreshTokens?: any[];
  accessTokens?: any[];
  revokedRefreshRows?: any[];
  groupScopes?: string[];
  authorizationCode?: any;
  pendingConsent?: any;
}) {
  const cacheSet = vi.fn().mockResolvedValue(undefined);
  const cacheGet = vi.fn().mockResolvedValue(options?.pendingConsent ?? null);
  const cacheDelete = vi.fn().mockResolvedValue(undefined);
  const client = {
    clientId: 'goc_client',
    clientName: 'Gateway OAuth CLI Test',
    clientUri: null,
    logoUri: null,
    redirectUris: ['http://127.0.0.1:8765/callback'],
  };
  const refreshTokens = options?.refreshTokens ?? [];
  const accessTokens = options?.accessTokens ?? [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const db = {
    query: {
      oauthClients: {
        findFirst: vi.fn().mockResolvedValue(client),
        findMany: vi.fn().mockResolvedValue([client]),
      },
      oauthRefreshTokens: {
        findFirst: vi.fn().mockResolvedValue(options?.refreshToken ?? null),
        findMany: vi.fn().mockResolvedValue(refreshTokens),
      },
      oauthAuthorizationCodes: {
        findFirst: vi.fn().mockResolvedValue(options?.authorizationCode ?? null),
      },
      oauthAccessTokens: {
        findMany: vi.fn().mockResolvedValue(accessTokens),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({
          id: USER.id,
          oidcSubject: USER.oidcSubject,
          email: USER.email,
          name: USER.name,
          avatarUrl: USER.avatarUrl,
          groupId: USER.groupId,
          isBlocked: USER.isBlocked,
        }),
      },
      permissionGroups: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: USER.groupId,
            name: USER.groupName,
            parentId: null,
            scopes: options?.groupScopes ?? USER.scopes,
          },
        ]),
      },
    },
    transaction: vi.fn(async (callback) => callback(db)),
    insert: vi.fn((table) => ({
      values: vi.fn((values) => {
        insertCalls.push({ table, values });
        return {
          returning: vi.fn().mockResolvedValue([{ id: 'refresh-new' }]),
        };
      }),
    })),
    update: vi.fn((table) => ({
      set: vi.fn((values) => ({
        where: vi.fn().mockImplementation(() => {
          updateCalls.push({ table, values });
          if (Array.isArray(values.scopes)) {
            const tokens =
              table === oauthRefreshTokens ? refreshTokens : table === oauthAccessTokens ? accessTokens : [];
            for (const token of tokens) token.scopes = values.scopes;
          }
          return Object.assign(Promise.resolve(), {
            returning: vi
              .fn()
              .mockResolvedValue(
                table === oauthRefreshTokens
                  ? values.replacedByTokenId !== undefined
                    ? [{ id: 'refresh-1' }]
                    : (options?.revokedRefreshRows ?? [])
                  : table === oauthAuthorizationCodes
                    ? [{ id: options?.authorizationCode?.id ?? 'code-1' }]
                    : []
              ),
          });
        }),
      })),
    })),
  };

  const auditLog = vi.fn().mockResolvedValue(undefined);
  const service = new OAuthService(
    db as any,
    { set: cacheSet, get: cacheGet, delete: cacheDelete } as any,
    { log: auditLog } as any
  );
  return { service, cacheSet, cacheGet, cacheDelete, auditLog, db, updateCalls, insertCalls };
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('OAuthService.registerClient', () => {
  it('rejects unsafe redirect URI schemes before storing the client', async () => {
    const { service, db } = createService();

    for (const redirectUri of ['javascript:alert(1)', 'file:///tmp/callback', 'http://client.example.com/callback']) {
      await expect(
        service.registerClient({
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          client_name: 'Unsafe Client',
        })
      ).rejects.toThrow('Redirect URI must use HTTPS or loopback HTTP');
    }

    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('OAuthService.createConsentRequest', () => {
  it('infers the MCP resource when an OAuth client requests mcp:use without a resource parameter', async () => {
    const { service, cacheSet } = createService();

    const pending = await service.createConsentRequest(USER, {
      response_type: 'code',
      client_id: 'goc_client',
      redirect_uri: 'http://127.0.0.1:8765/callback',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      scope: 'mcp:use nodes:details',
    });

    expect(pending.resource).toBe('https://gateway.example.com/api/mcp');
    expect(pending.requestedScopes).toEqual(['nodes:details']);
    expect(pending.grantableScopes).toEqual(['nodes:details']);
    expect(pending.unavailableScopes).toEqual([]);
    expect(cacheSet).toHaveBeenCalledWith(expect.stringContaining('oauth:consent:'), pending, 600);
  });

  it('rejects MCP OAuth requests when the user cannot use MCP', async () => {
    const { service } = createService();

    await expect(
      service.createConsentRequest(
        { ...USER, scopes: ['nodes:details'] },
        {
          response_type: 'code',
          client_id: 'goc_client',
          redirect_uri: 'http://127.0.0.1:8765/callback',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
          scope: 'mcp:use nodes:details',
        }
      )
    ).rejects.toThrow('Your account is not allowed to use MCP');
  });

  it('marks high-risk OAuth scopes for manual approval', async () => {
    const { service } = createService();

    const pending = await service.createConsentRequest(
      {
        ...USER,
        scopes: [
          ...USER.scopes,
          'docker:containers:environment',
          'docker:containers:files',
          'docker:containers:secrets',
          'pki:cert:export',
          'admin:update',
        ],
      },
      {
        response_type: 'code',
        client_id: 'goc_client',
        redirect_uri: 'http://127.0.0.1:8765/callback',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        scope:
          'nodes:details docker:containers:environment docker:containers:files:node-1 docker:containers:secrets pki:cert:export admin:update',
      }
    );

    expect(pending.grantableScopes).toEqual([
      'admin:update',
      'docker:containers:environment',
      'docker:containers:files:node-1',
      'docker:containers:secrets',
      'nodes:details',
      'pki:cert:export',
    ]);
    expect(pending.manualApprovalScopes).toEqual([
      'admin:update',
      'docker:containers:files:node-1',
      'docker:containers:secrets',
      'pki:cert:export',
    ]);
  });
});

describe('OAuthService.approveConsent', () => {
  function pendingConsent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'request-1',
      userId: USER.id,
      clientId: 'goc_client',
      clientName: 'Gateway OAuth CLI Test',
      clientUri: null,
      logoUri: null,
      redirectUri: 'http://127.0.0.1:8765/callback',
      requestedScopes: ['nodes:details', 'docker:containers:secrets'],
      grantableScopes: ['docker:containers:secrets', 'nodes:details'],
      unavailableScopes: [],
      manualApprovalScopes: ['docker:containers:secrets'],
      codeChallenge: 'challenge',
      resource: 'https://gateway.example.com/api',
      expiresAt: Date.now() + 60_000,
      ...overrides,
    };
  }

  it('defaults omitted approval scopes to non-dangerous grantable scopes', async () => {
    const { service, insertCalls } = createService({
      pendingConsent: pendingConsent(),
    });

    await service.approveConsent(
      'request-1',
      { ...USER, scopes: [...USER.scopes, 'docker:containers:secrets'] },
      undefined
    );

    const authorizationCodeInsert = insertCalls.find((call) => call.table === oauthAuthorizationCodes);
    expect(authorizationCodeInsert?.values.scopes).toEqual(['nodes:details']);
  });

  it('rejects an explicit empty approval scope list', async () => {
    const { service, db } = createService({
      pendingConsent: pendingConsent(),
    });

    await expect(
      service.approveConsent('request-1', { ...USER, scopes: [...USER.scopes, 'docker:containers:secrets'] }, [])
    ).rejects.toThrow('At least one scope must be selected');

    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('OAuthService.updateUserAuthorizationScopes', () => {
  it('updates active authorization scopes bounded by the current user scopes', async () => {
    const refreshToken = {
      clientId: 'goc_client',
      userId: USER.id,
      scopes: ['nodes:details'],
      resource: 'https://gateway.example.com/api/mcp',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-04-29T10:00:00Z'),
      revokedAt: null,
    };
    const { service, auditLog, updateCalls } = createService({
      refreshTokens: [refreshToken],
    });

    const authorization = await service.updateUserAuthorizationScopes(
      { ...USER, scopes: ['mcp:use', 'nodes:details', 'nodes:details:node-1'] },
      'goc_client',
      'https://gateway.example.com/api/mcp',
      ['nodes:details']
    );

    expect(updateCalls.some((call) => call.table === oauthRefreshTokens)).toBe(true);
    expect(refreshToken.scopes).toEqual(['nodes:details']);
    expect(authorization?.scopes).toEqual(['nodes:details']);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oauth.authorization_update',
        resourceId: 'goc_client',
      })
    );
  });

  it('rejects MCP authorization updates when the user can no longer use MCP', async () => {
    const { service } = createService({
      refreshTokens: [
        {
          clientId: 'goc_client',
          userId: USER.id,
          scopes: ['nodes:details'],
          resource: 'https://gateway.example.com/api/mcp',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date('2026-04-29T10:00:00Z'),
          revokedAt: null,
        },
      ],
    });

    await expect(
      service.updateUserAuthorizationScopes(
        { ...USER, scopes: ['nodes:details'] },
        'goc_client',
        'https://gateway.example.com/api/mcp',
        ['nodes:details']
      )
    ).rejects.toThrow('Your account is not allowed to use MCP');
  });
});

describe('OAuthService.listUserAuthorizations', () => {
  it('returns separate rows for the same client on different resources', async () => {
    const { service } = createService({
      refreshTokens: [
        {
          clientId: 'goc_client',
          userId: USER.id,
          scopes: ['nodes:details'],
          resource: 'https://gateway.example.com/api',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date('2026-04-29T10:00:00Z'),
          revokedAt: null,
        },
        {
          clientId: 'goc_client',
          userId: USER.id,
          scopes: ['nodes:details'],
          resource: 'https://gateway.example.com/api/mcp',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date('2026-04-29T11:00:00Z'),
          revokedAt: null,
        },
      ],
    });

    const authorizations = await service.listUserAuthorizations(USER.id);

    expect(authorizations).toHaveLength(2);
    expect(authorizations.map((authorization) => authorization.resource).sort()).toEqual([
      'https://gateway.example.com/api',
      'https://gateway.example.com/api/mcp',
    ]);
  });

  it('bounds listed authorization scopes by the owner current scopes', async () => {
    const { service } = createService({
      groupScopes: ['nodes:details:node-1'],
      refreshTokens: [
        {
          clientId: 'goc_client',
          userId: USER.id,
          scopes: ['nodes:details', 'nodes:details'],
          resource: 'https://gateway.example.com/api',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date('2026-04-29T10:00:00Z'),
          revokedAt: null,
        },
      ],
    });

    const [authorization] = await service.listUserAuthorizations(USER.id);

    expect(authorization.scopes).toEqual(['nodes:details:node-1']);
  });
});

describe('OAuthService.exchangeToken authorization code flow', () => {
  it('exchanges an authorization code when the PKCE verifier matches the stored S256 challenge', async () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
    const { service, insertCalls, updateCalls } = createService({
      authorizationCode: {
        id: 'code-1',
        clientId: 'goc_client',
        userId: USER.id,
        redirectUri: 'http://127.0.0.1:8765/callback',
        codeChallenge: s256(verifier),
        scopes: ['nodes:details'],
        resource: 'https://gateway.example.com/api',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await service.exchangeToken({
      grant_type: 'authorization_code',
      client_id: 'goc_client',
      code: 'gwo_code',
      redirect_uri: 'http://127.0.0.1:8765/callback',
      code_verifier: verifier,
    });

    expect(result.token_type).toBe('Bearer');
    expect(result.scope).toBe('nodes:details');
    expect(updateCalls.some((call) => call.table === oauthAuthorizationCodes)).toBe(true);
    expect(insertCalls).toHaveLength(2);
  });

  it('rejects an authorization code when the PKCE verifier does not match the stored S256 challenge', async () => {
    const { service, updateCalls } = createService({
      authorizationCode: {
        id: 'code-1',
        clientId: 'goc_client',
        userId: USER.id,
        redirectUri: 'http://127.0.0.1:8765/callback',
        codeChallenge: 'stored-challenge',
        scopes: ['nodes:details'],
        resource: 'https://gateway.example.com/api',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      service.exchangeToken({
        grant_type: 'authorization_code',
        client_id: 'goc_client',
        code: 'gwo_code',
        redirect_uri: 'http://127.0.0.1:8765/callback',
        code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
      })
    ).rejects.toThrow('Invalid PKCE verifier');

    expect(updateCalls).toEqual([]);
  });
});

describe('OAuthService.revokeToken', () => {
  it('rotates a valid refresh token by revoking and linking the old token to the new token', async () => {
    const { service, updateCalls, insertCalls, auditLog } = createService({
      refreshToken: {
        id: 'refresh-1',
        tokenHash: 'hash',
        clientId: 'goc_client',
        userId: USER.id,
        scopes: ['nodes:details'],
        resource: 'https://gateway.example.com/api',
        revokedAt: null,
        replacedByTokenId: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      revokedRefreshRows: [{ id: 'refresh-1', clientId: 'goc_client', userId: USER.id, resource: null }],
    });

    const result = await service.exchangeToken({
      grant_type: 'refresh_token',
      client_id: 'goc_client',
      refresh_token: 'gwr_valid',
    });

    expect(result.token_type).toBe('Bearer');
    expect(result.refresh_token).toMatch(/^gwr_/);
    expect(insertCalls).toHaveLength(2);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: oauthRefreshTokens,
          values: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
        expect.objectContaining({
          table: oauthRefreshTokens,
          values: { replacedByTokenId: 'refresh-new' },
        }),
      ])
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oauth.token_refresh',
        resourceId: 'goc_client',
      })
    );
  });

  it('revokes access tokens issued from a revoked refresh token', async () => {
    const { service, updateCalls } = createService({
      revokedRefreshRows: [{ id: 'refresh-1', clientId: 'goc_client', userId: USER.id, resource: null }],
    });

    await service.revokeToken('gwr_refresh_token', 'goc_client');

    const accessRevocations = updateCalls.filter((call) => call.table === oauthAccessTokens);
    expect(updateCalls.some((call) => call.table === oauthRefreshTokens)).toBe(true);
    expect(accessRevocations).toHaveLength(2);
    expect(accessRevocations.every((call) => call.values.revokedAt instanceof Date)).toBe(true);
  });

  it('revokes the refresh token family when a rotated refresh token is replayed', async () => {
    const { service, updateCalls } = createService({
      refreshToken: {
        id: 'refresh-1',
        tokenHash: 'hash',
        clientId: 'goc_client',
        userId: USER.id,
        scopes: ['nodes:details'],
        resource: 'https://gateway.example.com/api',
        revokedAt: new Date('2026-04-29T10:00:00Z'),
        replacedByTokenId: 'refresh-2',
        expiresAt: new Date(Date.now() + 60_000),
      },
      refreshTokens: [
        {
          id: 'refresh-1',
          clientId: 'goc_client',
          userId: USER.id,
          resource: 'https://gateway.example.com/api',
          replacedByTokenId: 'refresh-2',
        },
        {
          id: 'refresh-2',
          clientId: 'goc_client',
          userId: USER.id,
          resource: 'https://gateway.example.com/api',
          replacedByTokenId: null,
        },
      ],
    });

    await expect(
      service.exchangeToken({
        grant_type: 'refresh_token',
        client_id: 'goc_client',
        refresh_token: 'gwr_replayed',
      })
    ).rejects.toThrow('Invalid refresh token');

    const refreshRevocations = updateCalls.filter((call) => call.table === oauthRefreshTokens);
    const accessRevocations = updateCalls.filter((call) => call.table === oauthAccessTokens);
    expect(refreshRevocations.some((call) => call.values.revokedAt instanceof Date)).toBe(true);
    expect(accessRevocations.some((call) => call.values.revokedAt instanceof Date)).toBe(true);
  });

  it('revokes the refresh token family when concurrent refresh rotation loses the update race', async () => {
    const { service, updateCalls } = createService({
      refreshToken: {
        id: 'refresh-1',
        tokenHash: 'hash',
        clientId: 'goc_client',
        userId: USER.id,
        scopes: ['nodes:details'],
        resource: 'https://gateway.example.com/api',
        revokedAt: null,
        replacedByTokenId: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      refreshTokens: [
        {
          id: 'refresh-1',
          clientId: 'goc_client',
          userId: USER.id,
          resource: 'https://gateway.example.com/api',
          replacedByTokenId: 'refresh-2',
        },
        {
          id: 'refresh-2',
          clientId: 'goc_client',
          userId: USER.id,
          resource: 'https://gateway.example.com/api',
          replacedByTokenId: null,
        },
      ],
    });

    await expect(
      service.exchangeToken({
        grant_type: 'refresh_token',
        client_id: 'goc_client',
        refresh_token: 'gwr_racing',
      })
    ).rejects.toThrow('Refresh token already used');

    const refreshRevocations = updateCalls.filter((call) => call.table === oauthRefreshTokens);
    const accessRevocations = updateCalls.filter((call) => call.table === oauthAccessTokens);
    expect(refreshRevocations.some((call) => call.values.revokedAt instanceof Date)).toBe(true);
    expect(accessRevocations.some((call) => call.values.revokedAt instanceof Date)).toBe(true);
  });
});
