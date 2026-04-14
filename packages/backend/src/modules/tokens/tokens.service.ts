import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { apiTokens, permissionGroups, users } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { User } from '@/types.js';
import type { CreateTokenInput } from './tokens.schemas.js';

const logger = createChildLogger('TokensService');

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@injectable()
export class TokensService {
  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  async createToken(userId: string, input: CreateTokenInput) {
    const raw = `gw_${randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(raw);
    const tokenPrefix = raw.slice(0, 10);

    const [token] = await this.db
      .insert(apiTokens)
      .values({
        userId,
        name: input.name,
        tokenHash,
        tokenPrefix,
        scopes: input.scopes,
      })
      .returning();

    logger.info('Created API token', { tokenId: token.id, userId, scopes: input.scopes });

    return {
      id: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: token.scopes,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
      token: raw,
    };
  }

  async listTokens(userId: string) {
    const tokens = await this.db.query.apiTokens.findMany({
      where: eq(apiTokens.userId, userId),
    });

    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async renameToken(userId: string, tokenId: string, name: string): Promise<void> {
    const token = await this.db.query.apiTokens.findFirst({
      where: and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)),
    });
    if (!token) throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    await this.db.update(apiTokens).set({ name }).where(eq(apiTokens.id, tokenId));
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    const token = await this.db.query.apiTokens.findFirst({
      where: and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)),
    });

    if (!token) {
      throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    await this.db.delete(apiTokens).where(eq(apiTokens.id, tokenId));
    logger.info('Revoked API token', { tokenId, userId });
  }

  async validateToken(rawToken: string): Promise<{ user: User; scopes: string[] } | null> {
    const tokenHash = hashToken(rawToken);

    const token = await this.db.query.apiTokens.findFirst({
      where: eq(apiTokens.tokenHash, tokenHash),
    });

    if (!token) return null;

    this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, token.id))
      .execute()
      .catch((err) => logger.error('Failed to update lastUsedAt', { err }));

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, token.userId),
    });

    if (!user) return null;
    if (user.isBlocked) return null;

    // Fetch the user's group for populating the User object
    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, user.groupId),
    });

    return {
      user: {
        id: user.id,
        oidcSubject: user.oidcSubject,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        groupId: user.groupId,
        groupName: group?.name ?? 'unknown',
        scopes: (group?.scopes as string[]) ?? [],
        isBlocked: user.isBlocked,
      },
      scopes: token.scopes || [],
    };
  }

  /**
   * Check if scopes grant a required permission.
   * Supports hierarchical matching: 'cert:issue' grants 'cert:issue:ca-123'
   */
  static hasScope(scopes: string[], requiredScope: string): boolean {
    if (scopes.includes(requiredScope)) return true;
    const parts = requiredScope.split(':');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join(':');
      if (scopes.includes(prefix)) return true;
    }
    return false;
  }
}
