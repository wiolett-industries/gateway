import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { gitLabUserCredentials } from '@/db/schema/index.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { VcsConnectorAuth } from './integration-provider.types.js';

type CredentialRow = typeof gitLabUserCredentials.$inferSelect;

export interface ValidatedGitLabUserCredential {
  gitlabUserId: string;
  gitlabUsername: string;
  tokenScopes: string[];
  tokenExpiresAt: Date | null;
}

export interface SafeGitLabUserCredential {
  authorized: boolean;
  status: 'missing' | 'valid' | 'invalid';
  tokenMasked: string | null;
  gitlabUserId: string | null;
  gitlabUsername: string | null;
  tokenScopes: string[];
  tokenExpiresAt: Date | null;
  lastValidatedAt: Date | null;
}

export interface ResolvedGitLabUserCredential {
  auth: VcsConnectorAuth;
  scopes: string[];
  gitlabUserId: string;
  gitlabUsername: string;
}

export class GitLabUserCredentialsService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService
  ) {}

  async getStatus(userId: string, connectorId: string): Promise<SafeGitLabUserCredential> {
    const row = await this.find(userId, connectorId);
    if (!row) {
      return {
        authorized: false,
        status: 'missing',
        tokenMasked: null,
        gitlabUserId: null,
        gitlabUsername: null,
        tokenScopes: [],
        tokenExpiresAt: null,
        lastValidatedAt: null,
      };
    }

    return {
      authorized: row.status === 'valid',
      status: row.status,
      tokenMasked: `****${row.tokenLast4}`,
      gitlabUserId: row.gitlabUserId,
      gitlabUsername: row.gitlabUsername,
      tokenScopes: row.tokenScopes,
      tokenExpiresAt: row.tokenExpiresAt,
      lastValidatedAt: row.lastValidatedAt,
    };
  }

  async replace(
    userId: string,
    connectorId: string,
    token: string,
    identity: ValidatedGitLabUserCredential
  ): Promise<SafeGitLabUserCredential> {
    const now = new Date();
    const encryptedToken = JSON.stringify(this.cryptoService.encryptString(token));
    await this.db
      .insert(gitLabUserCredentials)
      .values({
        userId,
        connectorId,
        encryptedToken,
        tokenLast4: token.slice(-4),
        gitlabUserId: identity.gitlabUserId,
        gitlabUsername: identity.gitlabUsername,
        tokenScopes: identity.tokenScopes,
        tokenExpiresAt: identity.tokenExpiresAt,
        status: 'valid',
        lastValidatedAt: now,
        invalidatedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [gitLabUserCredentials.userId, gitLabUserCredentials.connectorId],
        set: {
          encryptedToken,
          tokenLast4: token.slice(-4),
          gitlabUserId: identity.gitlabUserId,
          gitlabUsername: identity.gitlabUsername,
          tokenScopes: identity.tokenScopes,
          tokenExpiresAt: identity.tokenExpiresAt,
          status: 'valid',
          lastValidatedAt: now,
          invalidatedAt: null,
          updatedAt: now,
        },
      });
    return this.getStatus(userId, connectorId);
  }

  async resolveAuth(
    userId: string,
    connectorId: string,
    baseUrl: string
  ): Promise<ResolvedGitLabUserCredential | null> {
    const row = await this.find(userId, connectorId);
    if (!row || row.status !== 'valid') return null;
    return {
      auth: {
        baseUrl,
        token: this.cryptoService.decryptString(JSON.parse(row.encryptedToken)),
      },
      scopes: row.tokenScopes,
      gitlabUserId: row.gitlabUserId,
      gitlabUsername: row.gitlabUsername,
    };
  }

  async markInvalid(userId: string, connectorId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(gitLabUserCredentials)
      .set({ status: 'invalid', invalidatedAt: now, updatedAt: now })
      .where(and(eq(gitLabUserCredentials.userId, userId), eq(gitLabUserCredentials.connectorId, connectorId)));
  }

  async disconnect(userId: string, connectorId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(gitLabUserCredentials)
      .where(and(eq(gitLabUserCredentials.userId, userId), eq(gitLabUserCredentials.connectorId, connectorId)))
      .returning({ id: gitLabUserCredentials.id });
    return deleted.length > 0;
  }

  private async find(userId: string, connectorId: string): Promise<CredentialRow | null> {
    const [row] = await this.db
      .select()
      .from(gitLabUserCredentials)
      .where(and(eq(gitLabUserCredentials.userId, userId), eq(gitLabUserCredentials.connectorId, connectorId)))
      .limit(1);
    return row ?? null;
  }
}
