import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups } from '@/db/schema/index.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv } from '@/types.js';

const SESSION_COOKIE_NAME = 'session_id';

function extractCredential(c: {
  req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined };
  cookie?: (name: string) => string | undefined;
}): { type: 'session' | 'apitoken'; value: string } | null {
  if (c.cookie) {
    const cookieSession = c.cookie(SESSION_COOKIE_NAME);
    if (cookieSession) return { type: 'session', value: cookieSession };
  }

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const value = authHeader.slice(7);
    if (value.startsWith('gw_')) {
      return { type: 'apitoken', value };
    }
    return { type: 'session', value };
  }

  // Query param fallback for SSE (EventSource can't set headers)
  const queryToken = c.req.query('token');
  if (queryToken) {
    if (queryToken.startsWith('gw_')) {
      return { type: 'apitoken', value: queryToken };
    }
    return { type: 'session', value: queryToken };
  }

  return null;
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const credential = extractCredential(c);

  if (!credential) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  if (credential.type === 'apitoken') {
    const tokensService = container.resolve(TokensService);
    const result = await tokensService.validateToken(credential.value);
    if (!result) {
      throw new HTTPException(401, { message: 'Invalid or expired API token' });
    }
    c.set('user', result.user);
    c.set('effectiveScopes', result.scopes);
    c.set('isTokenAuth', true);
  } else {
    const sessionService = container.resolve(SessionService);
    const session = await sessionService.getSession(credential.value);
    if (!session) {
      throw new HTTPException(401, { message: 'Invalid or expired session' });
    }
    let user = session.user;

    // Re-fetch user from DB if session has stale data (pre-migration)
    if (!user.scopes || !Array.isArray(user.scopes) || !user.groupId) {
      const authService = container.resolve(AuthService);
      const freshUser = await authService.getUserById(user.id);
      if (!freshUser) {
        throw new HTTPException(401, { message: 'User no longer exists' });
      }
      user = freshUser;
      sessionService.updateSession(credential.value, { user }).catch(() => {});
    }

    // Always resolve scopes from the live group definition (not session cache)
    // so group scope changes take effect without re-login.
    // Walk the parent chain to include inherited scopes.
    const db = container.resolve<DrizzleClient>(TOKENS.DrizzleClient);
    const allGroups = await db.query.permissionGroups.findMany({
      columns: { id: true, parentId: true, scopes: true, name: true },
    });
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));
    const group = groupMap.get(user.groupId);
    const scopeSet = new Set<string>();
    if (group) {
      for (const s of (group.scopes as string[]) ?? []) scopeSet.add(s);
      // Walk parent chain for inherited scopes
      const visited = new Set<string>([group.id]);
      let parent = group.parentId ? groupMap.get(group.parentId) : undefined;
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        for (const s of (parent.scopes as string[]) ?? []) scopeSet.add(s);
        parent = parent.parentId ? groupMap.get(parent.parentId) : undefined;
      }
    }
    const liveScopes = [...scopeSet];

    c.set('user', { ...user, scopes: liveScopes, groupName: group?.name ?? user.groupName });
    c.set('sessionId', credential.value);
    c.set('effectiveScopes', liveScopes);
    c.set('isTokenAuth', false);
    sessionService.refreshSession(credential.value, session).catch(() => {});
  }

  await next();
};

export const optionalAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const credential = extractCredential(c);

  if (credential) {
    if (credential.type === 'apitoken') {
      const tokensService = container.resolve(TokensService);
      const result = await tokensService.validateToken(credential.value);
      if (result) {
        c.set('user', result.user);
        c.set('effectiveScopes', result.scopes);
        c.set('isTokenAuth', true);
      }
    } else {
      const sessionService = container.resolve(SessionService);
      const session = await sessionService.getSession(credential.value);
      if (session) {
        let user = session.user;
        if (!user.scopes || !Array.isArray(user.scopes) || !user.groupId) {
          const authService = container.resolve(AuthService);
          const freshUser = await authService.getUserById(user.id);
          if (!freshUser) {
            await sessionService.destroySession(credential.value);
          } else {
            user = freshUser;
            sessionService.updateSession(credential.value, { user }).catch(() => {});
          }
        }
        if (user.groupId) {
          const db2 = container.resolve<DrizzleClient>(TOKENS.DrizzleClient);
          const grp = await db2.query.permissionGroups.findFirst({
            where: eq(permissionGroups.id, user.groupId),
            columns: { scopes: true, name: true },
          });
          const liveScopes = (grp?.scopes as string[]) ?? [];
          c.set('user', { ...user, scopes: liveScopes, groupName: grp?.name ?? user.groupName });
          c.set('sessionId', credential.value);
          c.set('effectiveScopes', liveScopes);
          c.set('isTokenAuth', false);
          sessionService.refreshSession(credential.value, session).catch(() => {});
        }
      }
    }
  }

  await next();
};

/**
 * Middleware that rejects blocked users. Apply to all API routes
 * except /auth/me and /auth/logout (which must remain accessible
 * so the frontend can detect blocked status and log out).
 */
export const requireActiveUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (user?.isBlocked) {
    throw new HTTPException(403, { message: 'Account is blocked' });
  }
  await next();
};

/**
 * Unified scope-based permission middleware.
 * Fires for BOTH session users and API token users.
 * Session users' scopes come from their permission group.
 * Token users' scopes come from the token itself.
 */
export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const scopes = c.get('effectiveScopes');
    if (!scopes || !TokensService.hasScope(scopes, scope)) {
      throw new HTTPException(403, { message: `Missing required scope: ${scope}` });
    }
    await next();
  };
}

/**
 * Require ANY of the listed scopes (OR logic).
 * Useful when a route should be accessible to users with different scope hierarchies.
 */
export function requireAnyScope(...requiredScopes: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const scopes = c.get('effectiveScopes');
    if (!scopes || !requiredScopes.some((s) => TokensService.hasScope(scopes, s))) {
      throw new HTTPException(403, { message: `Missing required scope: one of ${requiredScopes.join(', ')}` });
    }
    await next();
  };
}

/**
 * Resource-scoped permission check.
 * Builds scopeBase:resourceId from a URL param and checks against effective scopes.
 */
export function requireScopeForResource(scopeBase: string, paramName: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const resourceId = c.req.param(paramName);
    const scopes = c.get('effectiveScopes');
    const fullScope = resourceId ? `${scopeBase}:${resourceId}` : scopeBase;
    if (!scopes || !TokensService.hasScope(scopes, fullScope)) {
      throw new HTTPException(403, { message: `Missing required scope: ${fullScope}` });
    }
    await next();
  };
}

/**
 * Middleware that restricts access to session-authenticated users only.
 * API tokens are not allowed.
 */
export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('isTokenAuth')) {
    throw new HTTPException(403, {
      message: 'This endpoint requires session authentication. API tokens are not allowed.',
    });
  }
  await next();
};

export { SESSION_COOKIE_NAME };
