import { count, eq, like, not } from 'drizzle-orm';
import * as client from 'openid-client';
import { inject, injectable } from 'tsyringe';
import { getEnv } from '@/config/env.js';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups, users } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { canManageUser, isScopeSubset } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CacheService } from '@/services/cache.service.js';
import type { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';
import type { AuthSettingsService } from './auth.settings.service.js';
import { computeEffectiveGroupAccess, fetchGroupScopeMap, resolveEffectiveGroupAccess } from './live-session-user.js';

const logger = createChildLogger('AuthService');

const PKCE_STATE_PREFIX = 'oidc:pkce:';
const PRECREATED_SUBJECT_PREFIX = 'manual:';

export interface NormalizedOidcClaims {
  oidcSubject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export function normalizeOidcClaims(claims: Record<string, unknown> | undefined | null): NormalizedOidcClaims {
  const subject = typeof claims?.sub === 'string' ? claims.sub : '';
  if (!subject) {
    throw new Error('No subject claim in ID token');
  }

  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';

  return {
    oidcSubject: subject,
    email: email || null,
    emailVerified: claims?.email_verified === true,
    name: typeof claims?.name === 'string' && claims.name.trim() ? claims.name : null,
    avatarUrl: typeof claims?.picture === 'string' && claims.picture.trim() ? claims.picture : null,
  };
}

interface OIDCState {
  codeVerifier: string;
  state: string;
  returnTo?: string;
}

@injectable()
export class AuthService {
  private oidcConfig: client.Configuration | null = null;

  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly sessionService: SessionService,
    private readonly cacheService: CacheService,
    private readonly authSettingsService: AuthSettingsService,
    private readonly auditService: AuditService
  ) {}

  private eventBus?: import('@/services/event-bus.service.js').EventBusService;
  setEventBus(bus: import('@/services/event-bus.service.js').EventBusService) {
    this.eventBus = bus;
  }
  private emitUser(id: string, action: 'created' | 'updated' | 'deleted') {
    this.eventBus?.publish('user.changed', { id, action });
  }
  private emitPermissions(userId: string, scopes: string[], groupId: string | null) {
    this.eventBus?.publish(`permissions.changed.${userId}`, { scopes, groupId });
  }

  private async getOIDCConfig(): Promise<client.Configuration> {
    if (this.oidcConfig) {
      return this.oidcConfig;
    }

    const env = getEnv();

    try {
      this.oidcConfig = await client.discovery(new URL(env.OIDC_ISSUER), env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET);

      logger.info('OIDC configuration discovered', {
        issuer: env.OIDC_ISSUER,
      });

      return this.oidcConfig;
    } catch (error) {
      logger.error('Failed to discover OIDC configuration', { error });
      throw new Error('OIDC configuration discovery failed');
    }
  }

  async getAuthorizationUrl(returnTo?: string): Promise<string> {
    const env = getEnv();
    const config = await this.getOIDCConfig();

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();

    const oidcState: OIDCState = {
      codeVerifier,
      state,
      returnTo,
    };

    await this.cacheService.set(`${PKCE_STATE_PREFIX}${state}`, oidcState, 300);

    const parameters: Record<string, string> = {
      redirect_uri: env.OIDC_REDIRECT_URI,
      scope: env.OIDC_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    };

    const authorizationUrl = client.buildAuthorizationUrl(config, parameters);

    return authorizationUrl.href;
  }

  async handleCallback(
    callbackUrl: string,
    state: string
  ): Promise<{ sessionId: string; user: User; returnTo?: string }> {
    const config = await this.getOIDCConfig();

    const oidcState = await this.cacheService.get<OIDCState>(`${PKCE_STATE_PREFIX}${state}`);

    if (!oidcState) {
      throw new Error('Invalid or expired state parameter');
    }

    await this.cacheService.delete(`${PKCE_STATE_PREFIX}${state}`);

    if (oidcState.state !== state) {
      throw new Error('State mismatch');
    }

    try {
      const tokens = await client.authorizationCodeGrant(config, new URL(callbackUrl), {
        pkceCodeVerifier: oidcState.codeVerifier,
        expectedState: state,
      });

      const normalizedClaims = normalizeOidcClaims(tokens.claims() as Record<string, unknown> | undefined | null);
      const user = await this.findOrCreateUser(normalizedClaims);

      const { sessionId } = await this.sessionService.createSession(user, tokens.access_token, tokens.refresh_token);

      logger.info('User logged in', { userId: user.id, email: user.email });

      return {
        sessionId,
        user,
        returnTo: oidcState.returnTo,
      };
    } catch (error) {
      logger.error('OIDC callback handling failed', { error });
      throw error;
    }
  }

  private async findOrCreateUser(data: NormalizedOidcClaims): Promise<User> {
    const normalizedEmail = data.email;

    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.oidcSubject, data.oidcSubject),
    });

    if (existingUser) {
      const authSettings = await this.authSettingsService.getConfig();
      const canSyncEmail =
        normalizedEmail !== null &&
        (!authSettings.oidcRequireVerifiedEmail || data.emailVerified || existingUser.email === normalizedEmail);
      const nextEmail = canSyncEmail ? normalizedEmail : existingUser.email;

      if (
        existingUser.email !== nextEmail ||
        existingUser.name !== data.name ||
        existingUser.avatarUrl !== data.avatarUrl
      ) {
        const [updatedUser] = await this.db
          .update(users)
          .set({
            email: nextEmail,
            name: data.name,
            avatarUrl: data.avatarUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id))
          .returning();

        await this.auditService.log({
          userId: updatedUser.id,
          action: 'auth.user_profile_sync',
          resourceType: 'user',
          resourceId: updatedUser.id,
          details: {
            oidcSubject: data.oidcSubject,
            emailChanged: existingUser.email !== nextEmail,
            emailClaimIgnored:
              normalizedEmail !== null && existingUser.email !== normalizedEmail && nextEmail === existingUser.email,
            emailClaimMissing: normalizedEmail === null,
            emailVerified: data.emailVerified,
            nameChanged: existingUser.name !== data.name,
            avatarChanged: existingUser.avatarUrl !== data.avatarUrl,
          },
        });

        return this.mapDbUserToUser(updatedUser);
      }

      return this.mapDbUserToUser(existingUser);
    }

    if (!normalizedEmail) {
      throw new Error('No email claim in ID token');
    }

    const precreatedUser = await this.db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });

    if (precreatedUser?.oidcSubject.startsWith(PRECREATED_SUBJECT_PREFIX)) {
      await this.requireVerifiedEmailForNonBootstrap(data);
      const previousSubject = precreatedUser.oidcSubject;
      const [claimedUser] = await this.db
        .update(users)
        .set({
          oidcSubject: data.oidcSubject,
          email: normalizedEmail,
          name: data.name,
          avatarUrl: data.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, precreatedUser.id))
        .returning();

      logger.info('Claimed pre-created user on first login', {
        userId: claimedUser.id,
        email: claimedUser.email,
      });

      await this.auditService.log({
        userId: claimedUser.id,
        action: 'auth.user_claimed',
        resourceType: 'user',
        resourceId: claimedUser.id,
        details: {
          email: claimedUser.email,
          previousOidcSubject: previousSubject,
          oidcSubject: data.oidcSubject,
          emailVerified: data.emailVerified,
        },
      });

      this.emitUser(claimedUser.id, 'updated');
      const mapped = await this.mapDbUserToUser(claimedUser);
      this.emitPermissions(mapped.id, mapped.scopes, mapped.groupId);
      return mapped;
    }

    // Check if this is the first real user — assign system-admin group
    // Exclude system users (e.g. system:gateway-setup) from the count
    const [{ count: userCount }] = await this.db
      .select({ count: count() })
      .from(users)
      .where(not(like(users.oidcSubject, 'system:%')));

    const isBootstrapUser = userCount === 0;
    if (!isBootstrapUser) {
      await this.requireVerifiedEmailForNonBootstrap(data);
    }

    const group = isBootstrapUser
      ? await this.db.query.permissionGroups.findFirst({
          where: eq(permissionGroups.name, 'system-admin'),
        })
      : await this.resolveOidcProvisioningGroup();

    if (!group) {
      throw new Error('Default OIDC group not found. Has the migration been run?');
    }

    const [createdUser] = await this.db
      .insert(users)
      .values({
        oidcSubject: data.oidcSubject,
        email: normalizedEmail,
        name: data.name,
        avatarUrl: data.avatarUrl,
        groupId: group.id,
      })
      .returning();

    logger.info('Created new user', { userId: createdUser.id, email: createdUser.email, group: group.name });
    await this.auditService.log({
      userId: createdUser.id,
      action: 'auth.user_provisioned',
      resourceType: 'user',
      resourceId: createdUser.id,
      details: {
        email: createdUser.email,
        group: group.name,
        oidcSubject: data.oidcSubject,
        emailVerified: data.emailVerified,
        bootstrap: isBootstrapUser,
      },
    });
    this.emitUser(createdUser.id, 'created');
    const mapped = await this.mapDbUserToUser(createdUser);
    this.emitPermissions(mapped.id, mapped.scopes, mapped.groupId);
    return mapped;
  }

  private async requireVerifiedEmailForNonBootstrap(data: NormalizedOidcClaims): Promise<void> {
    const authSettings = await this.authSettingsService.getConfig();
    if (!authSettings.oidcRequireVerifiedEmail || data.emailVerified) return;

    throw new AppError(
      403,
      'OIDC_EMAIL_NOT_VERIFIED',
      'OIDC email verification is required for this account. Contact an administrator.'
    );
  }

  private async resolveOidcProvisioningGroup() {
    const authSettings = await this.authSettingsService.getConfig();
    if (!authSettings.oidcAutoCreateUsers) {
      throw new Error('Your account has not been provisioned yet. Contact an administrator.');
    }

    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, authSettings.oidcDefaultGroupId),
    });
    return group ?? null;
  }

  async createUser(data: { email: string; name?: string | null; groupId: string }): Promise<User> {
    const normalizedEmail = data.email.trim().toLowerCase();

    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, data.groupId),
    });
    if (!group) {
      throw new Error('Permission group not found');
    }

    const existingByEmail = await this.db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });
    if (existingByEmail) {
      throw new Error('User with this email already exists');
    }

    const [createdUser] = await this.db
      .insert(users)
      .values({
        oidcSubject: `${PRECREATED_SUBJECT_PREFIX}${normalizedEmail}`,
        email: normalizedEmail,
        name: data.name?.trim() || null,
        avatarUrl: null,
        groupId: data.groupId,
      })
      .returning();

    logger.info('Pre-created user', {
      userId: createdUser.id,
      email: createdUser.email,
      groupId: createdUser.groupId,
    });

    this.emitUser(createdUser.id, 'created');
    const mapped = await this.mapDbUserToUser(createdUser);
    this.emitPermissions(mapped.id, mapped.scopes, mapped.groupId);
    return mapped;
  }

  private async mapDbUserToUser(dbUser: typeof users.$inferSelect): Promise<User> {
    const effective = await resolveEffectiveGroupAccess(this.db, dbUser.groupId);

    return {
      id: dbUser.id,
      oidcSubject: dbUser.oidcSubject,
      email: dbUser.email,
      name: dbUser.name,
      avatarUrl: dbUser.avatarUrl,
      groupId: dbUser.groupId,
      groupName: effective.groupName,
      scopes: effective.scopes,
      isBlocked: dbUser.isBlocked,
    };
  }

  async logout(sessionId: string): Promise<string | null> {
    await this.sessionService.destroySession(sessionId);

    const config = await this.getOIDCConfig();
    const env = getEnv();

    try {
      const metadata = config.serverMetadata();
      if (metadata.end_session_endpoint) {
        const logoutUrl = new URL(metadata.end_session_endpoint);
        logoutUrl.searchParams.set('post_logout_redirect_uri', env.APP_URL);
        return logoutUrl.href;
      }
    } catch {
      // No end_session_endpoint available
    }

    return null;
  }

  async getUserById(userId: string): Promise<User | null> {
    const dbUser = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return dbUser ? this.mapDbUserToUser(dbUser) : null;
  }

  async listUsers(): Promise<User[]> {
    const allUsers = await this.db.query.users.findMany({
      orderBy: (users, { asc }) => [asc(users.createdAt)],
    });

    const groupMap = await fetchGroupScopeMap(this.db);

    return allUsers.map((u) => {
      const effective = computeEffectiveGroupAccess(u.groupId, groupMap);
      return {
        id: u.id,
        oidcSubject: u.oidcSubject,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatarUrl,
        groupId: u.groupId,
        groupName: effective.groupName,
        scopes: effective.scopes,
        isBlocked: u.isBlocked,
      };
    });
  }

  async updateUserGroup(userId: string, groupId: string): Promise<User> {
    // Verify the group exists
    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, groupId),
    });
    if (!group) {
      throw new Error('Permission group not found');
    }

    const [updatedUser] = await this.db
      .update(users)
      .set({ groupId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new Error('User not found');
    }

    const mapped = await this.mapDbUserToUser(updatedUser);
    this.emitUser(userId, 'updated');
    this.emitPermissions(userId, mapped.scopes, groupId);
    return mapped;
  }

  async assertCanUpdateUserGroup(
    actorUserId: string,
    actorScopes: string[],
    userId: string,
    groupId: string
  ): Promise<User> {
    if (userId === actorUserId) {
      throw new AppError(400, 'SELF_DEMOTION', 'Cannot change your own group');
    }

    const targetUser = await this.getUserById(userId);
    if (!targetUser) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    if (targetUser.oidcSubject.startsWith('system:')) {
      throw new AppError(403, 'SYSTEM_USER', 'Cannot modify the system user');
    }

    const denyReason = canManageUser(actorScopes, targetUser.scopes);
    if (denyReason) {
      throw new AppError(403, 'PRIVILEGE_BOUNDARY', denyReason);
    }

    const groupMap = await fetchGroupScopeMap(this.db);
    if (!groupMap.has(groupId)) {
      throw new AppError(404, 'NOT_FOUND', 'Permission group not found');
    }

    const destScopes = computeEffectiveGroupAccess(groupId, groupMap).scopes;
    if (!isScopeSubset(destScopes, actorScopes)) {
      throw new AppError(403, 'PRIVILEGE_BOUNDARY', 'Cannot assign a group with permissions you do not possess');
    }

    return targetUser;
  }

  async blockUser(userId: string): Promise<User> {
    const [updatedUser] = await this.db
      .update(users)
      .set({ isBlocked: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new Error('User not found');
    }

    this.emitUser(userId, 'updated');
    this.emitPermissions(userId, [], null);
    return this.mapDbUserToUser(updatedUser);
  }

  async unblockUser(userId: string): Promise<User> {
    const [updatedUser] = await this.db
      .update(users)
      .set({ isBlocked: false, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new Error('User not found');
    }

    const mapped = await this.mapDbUserToUser(updatedUser);
    this.emitUser(userId, 'updated');
    this.emitPermissions(userId, mapped.scopes, mapped.groupId ?? null);
    return mapped;
  }

  async deleteUser(userId: string): Promise<void> {
    // Destroy all sessions first
    await this.sessionService.destroyAllUserSessions(userId);

    const result = await this.db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });

    if (!result.length) {
      throw new Error('User not found');
    }

    logger.info('User deleted', { userId });
    this.emitUser(userId, 'deleted');
    this.emitPermissions(userId, [], null);
  }

  async validateSession(sessionId: string): Promise<User | null> {
    return this.sessionService.validateSession(sessionId);
  }
}
