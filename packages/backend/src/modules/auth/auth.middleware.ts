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
    const user = await tokensService.validateToken(credential.value);
    if (!user) {
      throw new HTTPException(401, { message: 'Invalid or expired API token' });
    }
    c.set('user', user);
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
      const user = await tokensService.validateToken(credential.value);
      if (user) {
        c.set('user', user);
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
 * RBAC middleware — restricts access to specified roles.
 */
export function rbacMiddleware(...allowedRoles: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    if (!allowedRoles.includes(user.role)) {
      throw new HTTPException(403, { message: 'Insufficient permissions' });
    }
    await next();
  };
}

export { SESSION_COOKIE_NAME };
