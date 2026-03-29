import { injectable, inject } from 'tsyringe';
import * as client from 'openid-client';
import { eq, count, not, like } from 'drizzle-orm';
import { TOKENS } from '@/container.js';
import { getEnv } from '@/config/env.js';
import { SessionService } from '@/services/session.service.js';
import { CacheService } from '@/services/cache.service.js';
import { createChildLogger } from '@/lib/logger.js';
import { users } from '@/db/schema/index.js';
import type { DrizzleClient } from '@/db/client.js';
import type { User, UserRole } from '@/types.js';

const logger = createChildLogger('AuthService');

const OIDC_CONFIG_CACHE_KEY = 'oidc:config';
const PKCE_STATE_PREFIX = 'oidc:pkce:';

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
    private readonly cacheService: CacheService
  ) {}

  private async getOIDCConfig(): Promise<client.Configuration> {
    if (this.oidcConfig) {
      return this.oidcConfig;
    }

    const env = getEnv();

    try {
      this.oidcConfig = await client.discovery(
        new URL(env.OIDC_ISSUER),
        env.OIDC_CLIENT_ID,
        env.OIDC_CLIENT_SECRET
      );

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

    await this.cacheService.set(
      `${PKCE_STATE_PREFIX}${state}`,
      oidcState,
      300
    );

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
    const env = getEnv();
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

      const claims = tokens.claims();

      if (!claims?.sub) {
        throw new Error('No subject claim in ID token');
      }

      const user = await this.findOrCreateUser({
        oidcSubject: claims.sub,
        email: claims.email as string,
        name: (claims.name as string) || null,
        avatarUrl: (claims.picture as string) || null,
      });

      const { sessionId } = await this.sessionService.createSession(
        user,
        tokens.access_token,
        tokens.refresh_token
      );

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

  private async findOrCreateUser(data: {
    oidcSubject: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  }): Promise<User> {
    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.oidcSubject, data.oidcSubject),
    });

    if (existingUser) {
      if (
        existingUser.email !== data.email ||
        existingUser.name !== data.name ||
        existingUser.avatarUrl !== data.avatarUrl
      ) {
        const [updatedUser] = await this.db
          .update(users)
          .set({
            email: data.email,
            name: data.name,
            avatarUrl: data.avatarUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id))
          .returning();

        return this.mapDbUserToUser(updatedUser);
      }

      return this.mapDbUserToUser(existingUser);
    }

    // Check if this is the first real user — assign admin role
    // Exclude system users (e.g. system:gateway-setup) from the count
    const [{ count: userCount }] = await this.db
      .select({ count: count() })
      .from(users)
      .where(not(like(users.oidcSubject, 'system:%')));

    const role: UserRole = userCount === 0 ? 'admin' : 'viewer';

    const [createdUser] = await this.db
      .insert(users)
      .values({
        oidcSubject: data.oidcSubject,
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl,
        role,
      })
      .returning();

    logger.info('Created new user', { userId: createdUser.id, email: createdUser.email, role });

    return this.mapDbUserToUser(createdUser);
  }

  private mapDbUserToUser(dbUser: typeof users.$inferSelect): User {
    return {
      id: dbUser.id,
      oidcSubject: dbUser.oidcSubject,
      email: dbUser.email,
      name: dbUser.name,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role,
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
    return allUsers.map(u => this.mapDbUserToUser(u));
  }

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    const [updatedUser] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new Error('User not found');
    }

    return this.mapDbUserToUser(updatedUser);
  }

  async validateSession(sessionId: string): Promise<User | null> {
    return this.sessionService.validateSession(sessionId);
  }
}
