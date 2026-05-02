import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { getEnv } from '@/config/env.js';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { oauthAccessTokens, oauthAuthorizationCodes, oauthClients, oauthRefreshTokens } from '@/db/schema/index.js';
import { boundScopes, hasScope, isScopeSubset } from '@/lib/permissions.js';
import {
  canonicalizeScopes,
  extractBaseScope,
  isApiTokenScope,
  isValidBaseScope,
  MANUAL_APPROVAL_SCOPE_SET,
  withoutManualApprovalScopes,
} from '@/lib/scopes.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { AuthSettingsService } from '@/modules/auth/auth.settings.service.js';
import { resolveLiveUser } from '@/modules/auth/live-session-user.js';
import type { CacheService } from '@/services/cache.service.js';
import type { User } from '@/types.js';
import type { OAuthAuthorizeQuery, OAuthClientRegistrationInput, OAuthTokenRequest } from './oauth.schemas.js';

const CONSENT_PREFIX = 'oauth:consent:';
const CONSENT_TTL_SECONDS = 600;
const AUTH_CODE_TTL_SECONDS = 300;
const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type PendingConsent = {
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUri: string;
  redirectUriIsExternal: boolean;
  state?: string;
  requestedScopes: string[];
  grantableScopes: string[];
  unavailableScopes: string[];
  manualApprovalScopes: string[];
  codeChallenge: string;
  resource: string;
  expiresAt: number;
};

function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function randomSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function parseScopeString(scope: string | undefined): string[] {
  if (!scope?.trim()) return [];
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
}

function assertGrantableScopes(scopes: string[]): void {
  const invalid = scopes.filter((scope) => !isApiTokenScope(scope));
  if (invalid.length > 0) {
    throw new AppError(400, 'INVALID_SCOPE', `Scopes are not grantable: ${invalid.join(', ')}`);
  }
}

function stripNonDelegableMcpScope(scopes: string[]): string[] {
  return scopes.filter((scope) => scope !== 'mcp:use');
}

function getManualApprovalScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => MANUAL_APPROVAL_SCOPE_SET.has(extractBaseScope(scope))).sort();
}

function resourceWhere(
  table: typeof oauthAccessTokens | typeof oauthRefreshTokens,
  resource: string,
  apiResource: string
) {
  return resource === apiResource
    ? or(isNull(table.resource), eq(table.resource, resource))
    : eq(table.resource, resource);
}

function publicMetadata(input: OAuthClientRegistrationInput): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== '' && value !== null)
  );
}

export function isLoopbackRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return isLoopbackHost && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

export function isExternalRedirectUri(uri: string): boolean {
  return !isLoopbackRedirectUri(uri);
}

function assertRedirectUriAllowed(uri: string, extendedCompatibility: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AppError(400, 'INVALID_REDIRECT_URI', 'Invalid redirect URI');
  }

  if (isLoopbackRedirectUri(uri)) return;
  if (extendedCompatibility && parsed.protocol === 'https:') return;
  throw new AppError(
    400,
    'INVALID_REDIRECT_URI',
    extendedCompatibility
      ? 'Redirect URI must use HTTPS or loopback HTTP'
      : 'OAuth dynamic registration allows only loopback callback URLs unless extended compatibility is enabled'
  );
}

@injectable()
export class OAuthService {
  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
    private readonly authSettingsService: AuthSettingsService
  ) {}

  getIssuerUrl(): string {
    return new URL(getEnv().APP_URL).origin;
  }

  getMcpResourceUrl(): string {
    return new URL('/api/mcp', getEnv().APP_URL).href;
  }

  getApiResourceUrl(): string {
    return new URL('/api', getEnv().APP_URL).href;
  }

  getProtectedResourceMetadataUrl(): string {
    return new URL('/.well-known/oauth-protected-resource/api/mcp', getEnv().APP_URL).href;
  }

  isSupportedResource(resource: string): boolean {
    return resource === this.getApiResourceUrl() || resource === this.getMcpResourceUrl();
  }

  private assertMcpResourceAllowed(user: User, resource: string): void {
    if (resource === this.getMcpResourceUrl() && !hasScope(user.scopes, 'mcp:use')) {
      throw new AppError(403, 'MCP_NOT_ALLOWED', 'Your account is not allowed to use MCP');
    }
  }

  async registerClient(input: OAuthClientRegistrationInput) {
    const oauthExtendedCallbackCompatibility = await this.authSettingsService.getOAuthExtendedCallbackCompatibility();
    for (const uri of input.redirect_uris) assertRedirectUriAllowed(uri, oauthExtendedCallbackCompatibility);

    const clientId = `goc_${randomBytes(18).toString('base64url')}`;
    const clientName = input.client_name?.trim() || 'OAuth Client';
    const [client] = await this.db
      .insert(oauthClients)
      .values({
        clientId,
        clientName,
        clientUri: input.client_uri ?? null,
        logoUri: input.logo_uri || null,
        redirectUris: input.redirect_uris,
        rawMetadata: publicMetadata(input),
      })
      .returning();

    await this.auditService.log({
      userId: null,
      action: 'oauth.client_register',
      resourceType: 'oauth-client',
      resourceId: client.clientId,
      details: { clientName, redirectUris: input.redirect_uris },
    });

    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      client_uri: client.clientUri ?? undefined,
      logo_uri: client.logoUri ?? undefined,
    };
  }

  async getClient(clientId: string) {
    return this.db.query.oauthClients.findFirst({ where: eq(oauthClients.clientId, clientId) });
  }

  async createConsentRequest(user: User, query: OAuthAuthorizeQuery): Promise<PendingConsent> {
    const client = await this.getClient(query.client_id);
    if (!client) throw new AppError(400, 'INVALID_CLIENT', 'Unknown OAuth client');
    if (!client.redirectUris.includes(query.redirect_uri)) {
      throw new AppError(400, 'INVALID_REDIRECT_URI', 'Redirect URI is not registered for this client');
    }
    const oauthExtendedCallbackCompatibility = await this.authSettingsService.getOAuthExtendedCallbackCompatibility();
    assertRedirectUriAllowed(query.redirect_uri, oauthExtendedCallbackCompatibility);

    const rawRequestedScopes = parseScopeString(query.scope);
    const requestedMcpAccess = rawRequestedScopes.includes('mcp:use');
    const delegableRequestedScopes = stripNonDelegableMcpScope(rawRequestedScopes);
    if (delegableRequestedScopes.length === 0) {
      throw new AppError(400, 'INVALID_SCOPE', 'At least one OAuth scope is required');
    }
    const invalidScopes = delegableRequestedScopes.filter((scope) => !isValidBaseScope(scope));
    if (invalidScopes.length > 0) {
      throw new AppError(400, 'INVALID_SCOPE', `Scopes are not recognized: ${invalidScopes.join(', ')}`);
    }
    const requestedScopes = canonicalizeScopes(delegableRequestedScopes);
    const resource = query.resource ?? (requestedMcpAccess ? this.getMcpResourceUrl() : this.getApiResourceUrl());
    if (!this.isSupportedResource(resource)) {
      throw new AppError(400, 'INVALID_TARGET', 'OAuth authorization is not available for this resource');
    }
    this.assertMcpResourceAllowed(user, resource);

    const grantableScopes = canonicalizeScopes(boundScopes(requestedScopes, user.scopes)).filter((scope) =>
      isApiTokenScope(scope)
    );
    const unavailableScopes = requestedScopes.filter(
      (scope) => !hasScope(user.scopes, scope) || !isApiTokenScope(scope)
    );

    const pending: PendingConsent = {
      id: randomBytes(18).toString('base64url'),
      userId: user.id,
      clientId: client.clientId,
      clientName: client.clientName,
      clientUri: client.clientUri,
      logoUri: client.logoUri,
      redirectUri: query.redirect_uri,
      redirectUriIsExternal: isExternalRedirectUri(query.redirect_uri),
      state: query.state,
      requestedScopes,
      grantableScopes,
      unavailableScopes,
      manualApprovalScopes: getManualApprovalScopes(grantableScopes),
      codeChallenge: query.code_challenge,
      resource,
      expiresAt: Date.now() + CONSENT_TTL_SECONDS * 1000,
    };

    await this.cacheService.set(`${CONSENT_PREFIX}${pending.id}`, pending, CONSENT_TTL_SECONDS);
    return pending;
  }

  async getConsentRequest(requestId: string, user: User): Promise<PendingConsent> {
    const pending = await this.cacheService.get<PendingConsent>(`${CONSENT_PREFIX}${requestId}`);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new AppError(404, 'OAUTH_REQUEST_EXPIRED', 'OAuth authorization request expired');
    }
    if (pending.userId !== user.id) {
      throw new AppError(403, 'OAUTH_REQUEST_USER_MISMATCH', 'This OAuth request belongs to another account');
    }
    const oauthExtendedCallbackCompatibility = await this.authSettingsService.getOAuthExtendedCallbackCompatibility();
    assertRedirectUriAllowed(pending.redirectUri, oauthExtendedCallbackCompatibility);

    this.assertMcpResourceAllowed(user, pending.resource);
    const grantableScopes = canonicalizeScopes(boundScopes(pending.requestedScopes, user.scopes)).filter((scope) =>
      isApiTokenScope(scope)
    );
    const unavailableScopes = pending.requestedScopes.filter(
      (scope) => !hasScope(user.scopes, scope) || !isApiTokenScope(scope)
    );
    return {
      ...pending,
      redirectUriIsExternal: pending.redirectUriIsExternal ?? isExternalRedirectUri(pending.redirectUri),
      grantableScopes,
      unavailableScopes,
      manualApprovalScopes: getManualApprovalScopes(grantableScopes),
    };
  }

  async approveConsent(requestId: string, user: User, selectedScopes?: string[]): Promise<string> {
    const pending = await this.getConsentRequest(requestId, user);
    const scopes = canonicalizeScopes(
      selectedScopes === undefined ? withoutManualApprovalScopes(pending.grantableScopes) : selectedScopes
    );
    assertGrantableScopes(scopes);
    if (!isScopeSubset(scopes, pending.grantableScopes)) {
      throw new AppError(403, 'SCOPE_NOT_ALLOWED', 'Selected scopes exceed the current user permissions');
    }
    if (scopes.length === 0) {
      throw new AppError(403, 'SCOPE_NOT_ALLOWED', 'At least one scope must be selected');
    }

    const code = randomSecret('gwo_code_');
    const [record] = await this.db
      .insert(oauthAuthorizationCodes)
      .values({
        codeHash: hashSecret(code),
        clientId: pending.clientId,
        userId: user.id,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        requestedScopes: pending.requestedScopes,
        scopes,
        resource: pending.resource,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
      })
      .returning();

    await this.cacheService.delete(`${CONSENT_PREFIX}${requestId}`);
    await this.auditService.log({
      userId: user.id,
      action: 'oauth.authorize',
      resourceType: 'oauth-client',
      resourceId: pending.clientId,
      details: { codeId: record.id, clientName: pending.clientName, requestedScopes: pending.requestedScopes, scopes },
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('code', code);
    if (pending.state) redirect.searchParams.set('state', pending.state);
    return redirect.href;
  }

  async denyConsent(requestId: string, user: User): Promise<string> {
    const pending = await this.getConsentRequest(requestId, user);
    await this.cacheService.delete(`${CONSENT_PREFIX}${requestId}`);
    await this.auditService.log({
      userId: user.id,
      action: 'oauth.deny',
      resourceType: 'oauth-client',
      resourceId: pending.clientId,
      details: { clientName: pending.clientName, requestedScopes: pending.requestedScopes },
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    if (pending.state) redirect.searchParams.set('state', pending.state);
    return redirect.href;
  }

  async exchangeToken(input: OAuthTokenRequest) {
    if (input.grant_type === 'authorization_code') return this.exchangeAuthorizationCode(input);
    return this.exchangeRefreshToken(input);
  }

  private async exchangeAuthorizationCode(input: OAuthTokenRequest) {
    if (!input.code || !input.redirect_uri || !input.code_verifier) {
      throw new AppError(400, 'INVALID_REQUEST', 'Authorization code, redirect URI, and code verifier are required');
    }

    const code = await this.db.query.oauthAuthorizationCodes.findFirst({
      where: eq(oauthAuthorizationCodes.codeHash, hashSecret(input.code)),
    });
    if (!code || code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri || code.usedAt) {
      throw new AppError(400, 'INVALID_GRANT', 'Invalid authorization code');
    }
    if (code.expiresAt.getTime() < Date.now()) throw new AppError(400, 'INVALID_GRANT', 'Authorization code expired');
    if (input.resource && input.resource !== (code.resource ?? this.getApiResourceUrl())) {
      throw new AppError(400, 'INVALID_TARGET', 'Resource does not match the authorization grant');
    }
    if (pkceChallenge(input.code_verifier) !== code.codeChallenge) {
      throw new AppError(400, 'INVALID_GRANT', 'Invalid PKCE verifier');
    }

    const user = await resolveLiveUser(this.db, code.userId);
    if (!user || user.isBlocked) throw new AppError(400, 'INVALID_GRANT', 'User is no longer active');
    const resource = code.resource ?? this.getApiResourceUrl();
    this.assertMcpResourceAllowed(user, resource);
    const scopes = canonicalizeScopes(boundScopes(code.scopes, user.scopes)).filter((scope) => isApiTokenScope(scope));
    if (scopes.length === 0) throw new AppError(400, 'INVALID_GRANT', 'User can no longer grant these scopes');

    const [usedCode] = await this.db
      .update(oauthAuthorizationCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(oauthAuthorizationCodes.id, code.id), isNull(oauthAuthorizationCodes.usedAt)))
      .returning({ id: oauthAuthorizationCodes.id });
    if (!usedCode) throw new AppError(400, 'INVALID_GRANT', 'Authorization code already used');
    const issued = await this.issueTokens({
      clientId: code.clientId,
      userId: code.userId,
      scopes,
      resource,
    });
    return issued.response;
  }

  private async exchangeRefreshToken(input: OAuthTokenRequest) {
    if (!input.refresh_token) throw new AppError(400, 'INVALID_REQUEST', 'Refresh token is required');
    const existing = await this.db.query.oauthRefreshTokens.findFirst({
      where: eq(oauthRefreshTokens.tokenHash, hashSecret(input.refresh_token)),
    });
    if (!existing || existing.clientId !== input.client_id || existing.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'INVALID_GRANT', 'Invalid refresh token');
    }
    if (existing.revokedAt || existing.replacedByTokenId) {
      await this.revokeRefreshTokenFamily(existing);
      throw new AppError(400, 'INVALID_GRANT', 'Invalid refresh token');
    }
    if (input.resource && input.resource !== (existing.resource ?? this.getApiResourceUrl())) {
      throw new AppError(400, 'INVALID_TARGET', 'Resource does not match the refresh token');
    }

    const user = await resolveLiveUser(this.db, existing.userId);
    if (!user || user.isBlocked) throw new AppError(400, 'INVALID_GRANT', 'User is no longer active');
    const resource = existing.resource ?? this.getApiResourceUrl();
    this.assertMcpResourceAllowed(user, resource);
    const scopes = canonicalizeScopes(boundScopes(existing.scopes, user.scopes)).filter((scope) =>
      isApiTokenScope(scope)
    );
    if (scopes.length === 0) throw new AppError(400, 'INVALID_GRANT', 'User can no longer grant these scopes');

    const issued = await this.db
      .transaction(async (tx) => {
        const now = new Date();
        const [rotatedToken] = await tx
          .update(oauthRefreshTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(oauthRefreshTokens.id, existing.id),
              isNull(oauthRefreshTokens.revokedAt),
              isNull(oauthRefreshTokens.replacedByTokenId)
            )
          )
          .returning({ id: oauthRefreshTokens.id });
        if (!rotatedToken) {
          throw new AppError(400, 'REFRESH_TOKEN_REPLAY', 'Refresh token already used');
        }

        const issuedTokens = await this.issueTokens(
          {
            clientId: existing.clientId,
            userId: existing.userId,
            scopes,
            resource,
          },
          tx
        );
        await tx
          .update(oauthRefreshTokens)
          .set({ replacedByTokenId: issuedTokens.refreshTokenId })
          .where(eq(oauthRefreshTokens.id, existing.id));
        return issuedTokens;
      })
      .catch(async (error) => {
        if (error instanceof AppError && error.code === 'REFRESH_TOKEN_REPLAY') {
          await this.revokeRefreshTokenFamily(existing);
          throw new AppError(400, 'INVALID_GRANT', 'Refresh token already used');
        }
        throw error;
      });

    await this.auditService.log({
      userId: existing.userId,
      action: 'oauth.token_refresh',
      resourceType: 'oauth-client',
      resourceId: existing.clientId,
      details: { scopes },
    });
    return issued.response;
  }

  private async revokeRefreshTokenFamily(
    seed: { id: string; clientId: string; userId: string; resource: string | null },
    now = new Date()
  ): Promise<string[]> {
    const apiResource = this.getApiResourceUrl();
    const familyTokens = await this.db.query.oauthRefreshTokens.findMany({
      where: and(
        eq(oauthRefreshTokens.clientId, seed.clientId),
        eq(oauthRefreshTokens.userId, seed.userId),
        resourceWhere(oauthRefreshTokens, seed.resource ?? apiResource, apiResource)
      ),
    });
    const family = new Set<string>([seed.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const token of familyTokens) {
        if (family.has(token.id) || (token.replacedByTokenId && family.has(token.replacedByTokenId))) {
          if (!family.has(token.id)) {
            family.add(token.id);
            changed = true;
          }
          if (token.replacedByTokenId && !family.has(token.replacedByTokenId)) {
            family.add(token.replacedByTokenId);
            changed = true;
          }
        }
      }
    }

    const ids = [...family];
    await Promise.all([
      this.db.update(oauthRefreshTokens).set({ revokedAt: now }).where(inArray(oauthRefreshTokens.id, ids)),
      this.db.update(oauthAccessTokens).set({ revokedAt: now }).where(inArray(oauthAccessTokens.refreshTokenId, ids)),
    ]);
    return ids;
  }

  private async issueTokens(
    input: { clientId: string; userId: string; scopes: string[]; resource: string },
    db: Pick<DrizzleClient, 'insert'> = this.db
  ) {
    const accessToken = randomSecret('gwo_');
    const refreshToken = randomSecret('gwr_');
    const now = Date.now();
    const scopes = canonicalizeScopes(input.scopes);
    const [refresh] = await db
      .insert(oauthRefreshTokens)
      .values({
        tokenHash: hashSecret(refreshToken),
        tokenPrefix: refreshToken.slice(0, 12),
        clientId: input.clientId,
        userId: input.userId,
        scopes,
        resource: input.resource,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .returning();
    await db.insert(oauthAccessTokens).values({
      tokenHash: hashSecret(accessToken),
      tokenPrefix: accessToken.slice(0, 12),
      clientId: input.clientId,
      userId: input.userId,
      refreshTokenId: refresh.id,
      scopes,
      resource: input.resource,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    });

    return {
      refreshTokenId: refresh.id,
      response: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        scope: scopes.join(' '),
        refresh_token: refreshToken,
      },
    };
  }

  async validateAccessToken(rawToken: string, options: { resource?: string } = {}) {
    const token = await this.db.query.oauthAccessTokens.findFirst({
      where: and(eq(oauthAccessTokens.tokenHash, hashSecret(rawToken)), isNull(oauthAccessTokens.revokedAt)),
    });
    if (!token || token.expiresAt.getTime() < Date.now()) return null;
    if (options.resource && (token.resource ?? this.getApiResourceUrl()) !== options.resource) return null;

    const user = await resolveLiveUser(this.db, token.userId);
    if (!user || user.isBlocked) return null;
    const scopes = canonicalizeScopes(boundScopes(token.scopes, user.scopes)).filter((scope) => isApiTokenScope(scope));

    this.db
      .update(oauthAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthAccessTokens.id, token.id))
      .execute()
      .catch(() => {});

    return {
      user,
      scopes,
      tokenId: token.id,
      tokenPrefix: token.tokenPrefix,
      clientId: token.clientId,
    };
  }

  async revokeToken(rawToken: string, clientId?: string): Promise<void> {
    const tokenHash = hashSecret(rawToken);
    const now = new Date();
    const accessWhere = clientId
      ? and(eq(oauthAccessTokens.tokenHash, tokenHash), eq(oauthAccessTokens.clientId, clientId))
      : eq(oauthAccessTokens.tokenHash, tokenHash);
    const refreshWhere = clientId
      ? and(eq(oauthRefreshTokens.tokenHash, tokenHash), eq(oauthRefreshTokens.clientId, clientId))
      : eq(oauthRefreshTokens.tokenHash, tokenHash);
    const revokedRefreshTokens = await this.db
      .update(oauthRefreshTokens)
      .set({ revokedAt: now })
      .where(refreshWhere)
      .returning({
        id: oauthRefreshTokens.id,
        clientId: oauthRefreshTokens.clientId,
        userId: oauthRefreshTokens.userId,
        resource: oauthRefreshTokens.resource,
      });
    const accessRevocations = [this.db.update(oauthAccessTokens).set({ revokedAt: now }).where(accessWhere)];
    if (revokedRefreshTokens.length > 0) {
      await Promise.all(revokedRefreshTokens.map((token) => this.revokeRefreshTokenFamily(token, now)));
    }
    await Promise.all(accessRevocations);
  }

  async listUserAuthorizations(userId: string) {
    const now = new Date();
    const [refreshTokens, accessTokens, user] = await Promise.all([
      this.db.query.oauthRefreshTokens.findMany({
        where: and(
          eq(oauthRefreshTokens.userId, userId),
          isNull(oauthRefreshTokens.revokedAt),
          gt(oauthRefreshTokens.expiresAt, now)
        ),
      }),
      this.db.query.oauthAccessTokens.findMany({
        where: and(
          eq(oauthAccessTokens.userId, userId),
          isNull(oauthAccessTokens.revokedAt),
          gt(oauthAccessTokens.expiresAt, now)
        ),
      }),
      resolveLiveUser(this.db, userId),
    ]);
    const ownerScopes = user?.scopes ?? [];

    const clientIds = [...new Set([...refreshTokens, ...accessTokens].map((token) => token.clientId))];
    if (clientIds.length === 0) return [];

    const clients = await this.db.query.oauthClients.findMany({
      where: inArray(oauthClients.clientId, clientIds),
    });
    const clientById = new Map(clients.map((client) => [client.clientId, client]));
    const groups = new Map<
      string,
      {
        clientId: string;
        resource: string;
        scopes: Set<string>;
        createdAt: Date;
        expiresAt: Date | null;
        lastUsedAt: Date | null;
        activeAccessTokens: number;
        activeRefreshTokens: number;
      }
    >();

    const apiResource = this.getApiResourceUrl();
    const ensure = (clientId: string, resource: string, createdAt: Date) => {
      const key = `${clientId}\0${resource}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          clientId,
          resource,
          scopes: new Set(),
          createdAt,
          expiresAt: null,
          lastUsedAt: null,
          activeAccessTokens: 0,
          activeRefreshTokens: 0,
        };
        groups.set(key, group);
      }
      if (createdAt < group.createdAt) group.createdAt = createdAt;
      return group;
    };

    for (const token of refreshTokens) {
      const group = ensure(token.clientId, token.resource ?? apiResource, token.createdAt);
      for (const scope of canonicalizeScopes(boundScopes(token.scopes ?? [], ownerScopes))) {
        if (isApiTokenScope(scope)) group.scopes.add(scope);
      }
      group.activeRefreshTokens += 1;
      if (!group.expiresAt || token.expiresAt > group.expiresAt) group.expiresAt = token.expiresAt;
    }

    for (const token of accessTokens) {
      const group = ensure(token.clientId, token.resource ?? apiResource, token.createdAt);
      for (const scope of canonicalizeScopes(boundScopes(token.scopes ?? [], ownerScopes))) {
        if (isApiTokenScope(scope)) group.scopes.add(scope);
      }
      group.activeAccessTokens += 1;
      if (!group.expiresAt || token.expiresAt > group.expiresAt) group.expiresAt = token.expiresAt;
      if (token.lastUsedAt && (!group.lastUsedAt || token.lastUsedAt > group.lastUsedAt)) {
        group.lastUsedAt = token.lastUsedAt;
      }
    }

    return [...groups.values()]
      .map((group) => {
        const client = clientById.get(group.clientId);
        return {
          clientId: group.clientId,
          clientName: client?.clientName ?? 'Unknown OAuth Client',
          clientUri: client?.clientUri ?? null,
          logoUri: client?.logoUri ?? null,
          scopes: canonicalizeScopes([...group.scopes]),
          resource: group.resource,
          resources: [group.resource],
          activeAccessTokens: group.activeAccessTokens,
          activeRefreshTokens: group.activeRefreshTokens,
          createdAt: group.createdAt.toISOString(),
          lastUsedAt: group.lastUsedAt?.toISOString() ?? null,
          expiresAt: group.expiresAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.lastUsedAt ?? a.createdAt);
        const bTime = Date.parse(b.lastUsedAt ?? b.createdAt);
        return bTime - aTime;
      });
  }

  async revokeUserAuthorization(userId: string, clientId: string, resource: string): Promise<void> {
    const client = await this.getClient(clientId);
    const now = new Date();
    const apiResource = this.getApiResourceUrl();
    await Promise.all([
      this.db
        .update(oauthAccessTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthAccessTokens.userId, userId),
            eq(oauthAccessTokens.clientId, clientId),
            resourceWhere(oauthAccessTokens, resource, apiResource)
          )
        ),
      this.db
        .update(oauthRefreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthRefreshTokens.userId, userId),
            eq(oauthRefreshTokens.clientId, clientId),
            resourceWhere(oauthRefreshTokens, resource, apiResource)
          )
        ),
    ]);
    await this.auditService.log({
      userId,
      action: 'oauth.authorization_revoke',
      resourceType: 'oauth-client',
      resourceId: clientId,
      details: { clientName: client?.clientName ?? 'Unknown OAuth Client', resource },
    });
  }

  async updateUserAuthorizationScopes(user: User, clientId: string, resource: string, requestedScopes: string[]) {
    const client = await this.getClient(clientId);
    if (!client) throw new AppError(404, 'OAUTH_CLIENT_NOT_FOUND', 'OAuth client not found');
    if (!this.isSupportedResource(resource)) {
      throw new AppError(400, 'INVALID_TARGET', 'OAuth authorization is not available for this resource');
    }
    const canonicalRequestedScopes = canonicalizeScopes(stripNonDelegableMcpScope(requestedScopes));
    if (canonicalRequestedScopes.length === 0) {
      throw new AppError(400, 'INVALID_SCOPE', 'At least one scope is required');
    }

    const invalidScopes = requestedScopes.filter((scope) => !isValidBaseScope(scope));
    if (invalidScopes.length > 0) {
      throw new AppError(400, 'INVALID_SCOPE', `Scopes are not recognized: ${invalidScopes.join(', ')}`);
    }

    const now = new Date();
    const apiResource = this.getApiResourceUrl();
    const [refreshTokens, accessTokens] = await Promise.all([
      this.db.query.oauthRefreshTokens.findMany({
        where: and(
          eq(oauthRefreshTokens.userId, user.id),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt),
          gt(oauthRefreshTokens.expiresAt, now),
          resourceWhere(oauthRefreshTokens, resource, apiResource)
        ),
      }),
      this.db.query.oauthAccessTokens.findMany({
        where: and(
          eq(oauthAccessTokens.userId, user.id),
          eq(oauthAccessTokens.clientId, clientId),
          isNull(oauthAccessTokens.revokedAt),
          gt(oauthAccessTokens.expiresAt, now),
          resourceWhere(oauthAccessTokens, resource, apiResource)
        ),
      }),
    ]);
    if (refreshTokens.length === 0 && accessTokens.length === 0) {
      throw new AppError(404, 'OAUTH_AUTHORIZATION_NOT_FOUND', 'OAuth authorization not found');
    }

    this.assertMcpResourceAllowed(user, resource);
    const scopes = canonicalizeScopes(boundScopes(canonicalRequestedScopes, user.scopes)).filter((scope) =>
      isApiTokenScope(scope)
    );
    if (scopes.length === 0) {
      throw new AppError(400, 'INVALID_SCOPE', `No selected scopes are grantable for resource ${resource}`);
    }

    await Promise.all([
      this.db
        .update(oauthRefreshTokens)
        .set({ scopes })
        .where(
          and(
            eq(oauthRefreshTokens.userId, user.id),
            eq(oauthRefreshTokens.clientId, clientId),
            isNull(oauthRefreshTokens.revokedAt),
            gt(oauthRefreshTokens.expiresAt, now),
            resourceWhere(oauthRefreshTokens, resource, apiResource)
          )
        ),
      this.db
        .update(oauthAccessTokens)
        .set({ scopes })
        .where(
          and(
            eq(oauthAccessTokens.userId, user.id),
            eq(oauthAccessTokens.clientId, clientId),
            isNull(oauthAccessTokens.revokedAt),
            gt(oauthAccessTokens.expiresAt, now),
            resourceWhere(oauthAccessTokens, resource, apiResource)
          )
        ),
    ]);

    await this.auditService.log({
      userId: user.id,
      action: 'oauth.authorization_update',
      resourceType: 'oauth-client',
      resourceId: clientId,
      details: { clientName: client.clientName, resource, scopes },
    });

    const [authorization] = (await this.listUserAuthorizations(user.id)).filter(
      (item) => item.clientId === clientId && item.resource === resource
    );
    return authorization;
  }
}
