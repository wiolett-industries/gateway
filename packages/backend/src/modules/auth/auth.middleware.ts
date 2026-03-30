import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { container } from '@/container.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv, UserRole } from '@/types.js';

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
    c.set('tokenScopes', result.scopes);
  } else {
    const sessionService = container.resolve(SessionService);
    const session = await sessionService.getSession(credential.value);
    if (!session) {
      throw new HTTPException(401, { message: 'Invalid or expired session' });
    }
    c.set('user', session.user);
    c.set('sessionId', credential.value);
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
        c.set('tokenScopes', result.scopes);
      }
    } else {
      const sessionService = container.resolve(SessionService);
      const session = await sessionService.getSession(credential.value);
      if (session) {
        c.set('user', session.user);
        c.set('sessionId', credential.value);
        sessionService.refreshSession(credential.value, session).catch(() => {});
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
  if (user?.role === 'blocked') {
    throw new HTTPException(403, { message: 'Account is blocked' });
  }
  await next();
};

/**
 * RBAC middleware — restricts access to specified roles.
 */
export function rbacMiddleware(...allowedRoles: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    if (user.role === 'blocked') {
      throw new HTTPException(403, { message: 'Account is blocked' });
    }
    if (!allowedRoles.includes(user.role)) {
      throw new HTTPException(403, { message: 'Insufficient permissions' });
    }
    await next();
  };
}

export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tokenScopes = c.get('tokenScopes');
    if (tokenScopes !== undefined) {
      if (!TokensService.hasScope(tokenScopes, scope)) {
        throw new HTTPException(403, { message: `Token missing required scope: ${scope}` });
      }
    }
    await next();
  };
}

export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const tokenScopes = c.get('tokenScopes');
  if (tokenScopes !== undefined) {
    throw new HTTPException(403, { message: 'This endpoint requires session authentication. API tokens are not allowed.' });
  }
  await next();
};

export { SESSION_COOKIE_NAME };
