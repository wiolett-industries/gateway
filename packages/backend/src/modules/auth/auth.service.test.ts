import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AuthService, type NormalizedOidcClaims, normalizeOidcClaims } from './auth.service.js';

const authorizationCodeGrantMock = vi.hoisted(() => vi.fn());

vi.mock('openid-client', () => ({
  authorizationCodeGrant: authorizationCodeGrantMock,
}));

vi.mock('./live-session-user.js', () => ({
  resolveEffectiveGroupAccess: vi.fn().mockResolvedValue({
    groupName: 'admin',
    scopes: ['nodes:details'],
  }),
  computeEffectiveGroupAccess: vi.fn(),
  fetchGroupScopeMap: vi.fn(),
}));

describe('AuthService.blockUser', () => {
  it('keeps sessions available so blocked users can reach status and logout endpoints', async () => {
    const dbUser = {
      id: '11111111-1111-4111-8111-111111111111',
      oidcSubject: 'oidc-user',
      email: 'user@example.com',
      name: 'User',
      avatarUrl: null,
      groupId: 'group-1',
      isBlocked: true,
    };
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([dbUser]),
          })),
        })),
      })),
    };
    const sessionService = {
      destroyAllUserSessions: vi.fn(),
    };
    const eventBus = {
      publish: vi.fn(),
    };
    const service = new AuthService(db as any, sessionService as any, {} as any, {} as any, {} as any);
    service.setEventBus(eventBus as any);

    const user = await service.blockUser(dbUser.id);

    expect(user.isBlocked).toBe(true);
    expect(sessionService.destroyAllUserSessions).not.toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith('user.changed', { id: dbUser.id, action: 'updated' });
    expect(eventBus.publish).toHaveBeenCalledWith(`permissions.changed.${dbUser.id}`, {
      scopes: [],
      groupId: null,
    });
  });
});

describe('normalizeOidcClaims', () => {
  it('requires a subject claim', () => {
    expect(() => normalizeOidcClaims({ email: 'user@example.com' })).toThrow('No subject claim in ID token');
  });

  it('allows missing email so existing subject-bound users can still be resolved', () => {
    expect(normalizeOidcClaims({ sub: 'oidc-sub' })).toMatchObject({
      oidcSubject: 'oidc-sub',
      email: null,
    });
    expect(normalizeOidcClaims({ sub: 'oidc-sub', email: '   ' })).toMatchObject({
      oidcSubject: 'oidc-sub',
      email: null,
    });
  });

  it('preserves the OIDC subject as an opaque identifier', () => {
    expect(normalizeOidcClaims({ sub: ' oidc-sub ', email: 'user@example.com' })).toMatchObject({
      oidcSubject: ' oidc-sub ',
      email: 'user@example.com',
    });
  });

  it('normalizes email and treats only boolean true as verified', () => {
    expect(
      normalizeOidcClaims({
        sub: 'oidc-sub',
        email: ' User@Example.COM ',
        email_verified: true,
        name: 'User',
        picture: 'https://example.com/avatar.png',
      })
    ).toEqual({
      oidcSubject: 'oidc-sub',
      email: 'user@example.com',
      emailVerified: true,
      name: 'User',
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(
      normalizeOidcClaims({
        sub: 'oidc-sub',
        email: 'user@example.com',
        email_verified: 'true',
      }).emailVerified
    ).toBe(false);
  });
});

describe('AuthService OIDC identity binding', () => {
  it('allows an existing subject-bound user when the provider omits email', async () => {
    const existingUser = dbUser({
      oidcSubject: 'real-sub',
      email: 'old@example.com',
      name: 'Old Name',
      avatarUrl: null,
    });
    const updatedUser = { ...existingUser, name: 'New Name' };
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      existingBySubject: existingUser,
      updateReturning: updatedUser,
    });

    const result = await harness.loginWithClaims({
      oidcSubject: 'real-sub',
      email: null,
      emailVerified: false,
      name: 'New Name',
      avatarUrl: null,
    });

    expect(result.user.email).toBe('old@example.com');
    expect(harness.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'old@example.com',
        name: 'New Name',
      })
    );
    expect(harness.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.user_profile_sync',
        details: expect.objectContaining({
          oidcSubject: 'real-sub',
          emailClaimMissing: true,
          emailVerified: false,
        }),
      })
    );
  });

  it('allows an existing subject-bound user with unverified email and does not sync a changed email', async () => {
    const existingUser = dbUser({
      oidcSubject: 'real-sub',
      email: 'old@example.com',
      name: 'Old Name',
      avatarUrl: null,
    });
    const updatedUser = { ...existingUser, name: 'New Name', avatarUrl: 'https://example.com/avatar.png' };
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      existingBySubject: existingUser,
      updateReturning: updatedUser,
    });

    const result = await harness.loginWithClaims({
      oidcSubject: 'real-sub',
      email: 'new@example.com',
      emailVerified: false,
      name: 'New Name',
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(result.user.email).toBe('old@example.com');
    expect(harness.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'old@example.com',
        name: 'New Name',
        avatarUrl: 'https://example.com/avatar.png',
      })
    );
    expect(harness.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.user_profile_sync',
        details: expect.objectContaining({
          oidcSubject: 'real-sub',
          emailChanged: false,
          emailClaimIgnored: true,
          emailVerified: false,
        }),
      })
    );
  });

  it('rejects pre-created user claim when verified-email mode is enabled and email is unverified', async () => {
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      existingByEmail: dbUser({
        id: 'user-1',
        oidcSubject: 'manual:user@example.com',
        email: 'user@example.com',
        groupId: 'admin-group',
      }),
    });

    await expect(
      harness.loginWithClaims({
        oidcSubject: 'real-sub',
        email: 'user@example.com',
        emailVerified: false,
        name: 'User',
        avatarUrl: null,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'OIDC_EMAIL_NOT_VERIFIED',
    });
  });

  it('claims a pre-created user when verified-email mode is enabled and email is verified', async () => {
    const claimedUser = dbUser({
      id: 'user-1',
      oidcSubject: 'real-sub',
      email: 'user@example.com',
      name: 'User',
    });
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      existingByEmail: dbUser({
        id: 'user-1',
        oidcSubject: 'manual:user@example.com',
        email: 'user@example.com',
        groupId: 'admin-group',
      }),
      updateReturning: claimedUser,
    });

    const result = await harness.loginWithClaims({
      oidcSubject: 'real-sub',
      email: 'user@example.com',
      emailVerified: true,
      name: 'User',
      avatarUrl: null,
    });

    expect(result.user.oidcSubject).toBe('real-sub');
    expect(harness.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.user_claimed',
        details: expect.objectContaining({
          previousOidcSubject: 'manual:user@example.com',
          oidcSubject: 'real-sub',
          emailVerified: true,
        }),
      })
    );
  });

  it('rejects post-bootstrap auto-create when verified-email mode is enabled and email is unverified', async () => {
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      userCount: 1,
      provisioningGroup: { id: 'viewer-group', name: 'viewer' },
    });

    await expect(
      harness.loginWithClaims({
        oidcSubject: 'real-sub',
        email: 'user@example.com',
        emailVerified: false,
        name: 'User',
        avatarUrl: null,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'OIDC_EMAIL_NOT_VERIFIED',
    });
  });

  it('allows first-user bootstrap when email is unverified', async () => {
    const createdUser = dbUser({
      id: 'user-1',
      oidcSubject: 'real-sub',
      email: 'user@example.com',
      name: 'User',
      groupId: 'admin-group',
    });
    const harness = createAuthServiceHarness({
      authSettings: {
        oidcAutoCreateUsers: true,
        oidcDefaultGroupId: 'viewer-group',
        oidcRequireVerifiedEmail: true,
      },
      userCount: 0,
      provisioningGroup: { id: 'admin-group', name: 'system-admin' },
      insertReturning: createdUser,
    });

    const result = await harness.loginWithClaims({
      oidcSubject: 'real-sub',
      email: 'user@example.com',
      emailVerified: false,
      name: 'User',
      avatarUrl: null,
    });

    expect(result.user.id).toBe('user-1');
    expect(harness.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.user_provisioned',
        details: expect.objectContaining({
          oidcSubject: 'real-sub',
          emailVerified: false,
          bootstrap: true,
        }),
      })
    );
  });
});

function dbUser(overrides: Partial<DbUser> = {}): DbUser {
  return {
    id: 'user-1',
    oidcSubject: 'real-sub',
    email: 'user@example.com',
    name: null,
    avatarUrl: null,
    groupId: 'group-1',
    isBlocked: false,
    ...overrides,
  };
}

interface DbUser {
  id: string;
  oidcSubject: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  groupId: string;
  isBlocked: boolean;
}

function createAuthServiceHarness(options: {
  authSettings: {
    oidcAutoCreateUsers: boolean;
    oidcDefaultGroupId: string;
    oidcRequireVerifiedEmail: boolean;
  };
  existingBySubject?: DbUser | null;
  existingByEmail?: DbUser | null;
  userCount?: number;
  provisioningGroup?: { id: string; name: string } | null;
  updateReturning?: DbUser;
  insertReturning?: DbUser;
}) {
  const updateSet = vi.fn((_: unknown) => ({
    where: vi.fn(() => ({
      returning: vi
        .fn()
        .mockResolvedValue([options.updateReturning ?? options.existingBySubject ?? options.existingByEmail]),
    })),
  }));
  const insertValues = vi.fn((_: unknown) => ({
    returning: vi.fn().mockResolvedValue([options.insertReturning]),
  }));

  const db = {
    query: {
      users: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(options.existingBySubject ?? null)
          .mockResolvedValueOnce(options.existingByEmail ?? null),
      },
      permissionGroups: {
        findFirst: vi.fn().mockResolvedValue(options.provisioningGroup ?? { id: 'viewer-group', name: 'viewer' }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ count: options.userCount ?? 1 }]),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  };
  const sessionService = {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
  };
  const cacheService = {
    get: vi.fn().mockResolvedValue({ codeVerifier: 'verifier', state: 'state' }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const authSettingsService = {
    getConfig: vi.fn().mockResolvedValue(options.authSettings),
  };
  const auditService = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    db as any,
    sessionService as any,
    cacheService as any,
    authSettingsService as any,
    auditService as any
  );
  (service as any).oidcConfig = {};

  return {
    auditService,
    updateSet,
    async loginWithClaims(claims: NormalizedOidcClaims) {
      authorizationCodeGrantMock.mockResolvedValueOnce({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        claims: () => ({
          sub: claims.oidcSubject,
          email: claims.email,
          email_verified: claims.emailVerified,
          name: claims.name,
          picture: claims.avatarUrl,
        }),
      });

      return service.handleCallback('https://gateway.example.com/callback?code=code&state=state', 'state');
    },
  };
}
