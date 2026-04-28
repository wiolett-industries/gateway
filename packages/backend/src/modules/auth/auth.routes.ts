import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import { getEnv, isDevelopment } from '@/config/env.js';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv } from '@/types.js';
import { csrfTokenRoute, currentUserRoute, logoutRoute } from './auth.docs.js';
import { authMiddleware, SESSION_COOKIE_NAME, sessionOnly } from './auth.middleware.js';
import { AuthService } from './auth.service.js';

export const authRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

// Login route
const loginRoute = createRoute({
  method: 'get',
  path: '/login',
  tags: ['Authentication'],
  summary: 'Initiate OIDC login',
  request: {
    query: z.object({
      return_to: z.string().url().optional(),
    }),
  },
  responses: {
    302: { description: 'Redirect to OIDC provider' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Failed to initiate login' },
  },
});

authRoutes.openapi(loginRoute, async (c) => {
  const authService = container.resolve(AuthService);
  const { return_to } = c.req.valid('query');
  const authUrl = await authService.getAuthorizationUrl(return_to);
  return c.redirect(authUrl, 302);
});

// Callback route
const callbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: ['Authentication'],
  summary: 'OIDC callback',
  request: {
    query: z.object({
      code: z.string(),
      state: z.string(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: {
    302: { description: 'Redirect to application' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Authentication failed' },
  },
});

authRoutes.openapi(callbackRoute, async (c) => {
  const authService = container.resolve(AuthService);
  const auditService = container.resolve(AuditService);
  const env = getEnv();
  const { state, error, error_description } = c.req.valid('query');

  if (error) {
    await auditService.log({
      userId: null,
      action: 'auth.login_failed',
      resourceType: 'session',
      details: { error, errorDescription: error_description || null },
    });
    return c.json({ code: 'AUTH_ERROR', message: error_description || error }, 400);
  }

  try {
    const requestUrl = new URL(c.req.url);
    const callbackUrl = new URL(env.OIDC_REDIRECT_URI);
    callbackUrl.search = requestUrl.search;

    const result = await authService.handleCallback(callbackUrl.toString(), state);
    await auditService.log({
      userId: result.user.id,
      action: 'auth.login',
      resourceType: 'session',
      details: { returnTo: result.returnTo ?? null },
    });

    setCookie(c, SESSION_COOKIE_NAME, result.sessionId, {
      httpOnly: true,
      secure: !isDevelopment(),
      sameSite: 'Lax',
      maxAge: env.SESSION_EXPIRY,
      path: '/',
    });

    let baseUrl = env.APP_URL;
    if (result.returnTo) {
      try {
        if (new URL(result.returnTo).origin === new URL(env.APP_URL).origin) {
          baseUrl = result.returnTo;
        }
      } catch {
        // Invalid URL, use default
      }
    }
    const redirectUrl = new URL('/callback', baseUrl);
    return c.redirect(redirectUrl.toString(), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    await auditService.log({
      userId: null,
      action: 'auth.login_failed',
      resourceType: 'session',
      details: { error: message },
    });
    return c.json({ code: 'AUTH_ERROR', message }, 400);
  }
});

// CSRF token for cookie-authenticated browser mutations
authRoutes.use('/csrf', authMiddleware);
authRoutes.use('/csrf', sessionOnly);
authRoutes.openapi(csrfTokenRoute, async (c) => {
  const sessionId = c.get('sessionId');
  if (!sessionId) {
    return c.json({ code: 'AUTH_ERROR', message: 'Not a session-based login' }, 400);
  }
  const sessionService = container.resolve(SessionService);
  const csrfToken = await sessionService.ensureCsrfToken(sessionId);
  if (!csrfToken) {
    return c.json({ code: 'AUTH_ERROR', message: 'Invalid or expired session' }, 401);
  }
  return c.json({ csrfToken });
});

// Logout
authRoutes.use('/logout', authMiddleware);
authRoutes.openapi(logoutRoute, async (c) => {
  const sessionId = c.get('sessionId');
  if (!sessionId) {
    return c.json({ message: 'Not a session-based login' }, 400);
  }
  const authService = container.resolve(AuthService);
  const auditService = container.resolve(AuditService);
  const user = c.get('user');
  await auditService.log({
    userId: user?.id ?? null,
    action: 'auth.logout',
    resourceType: 'session',
    details: { hasSession: true },
  });
  const logoutUrl = await authService.logout(sessionId);
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ message: 'Logged out successfully', logoutUrl });
});

// Get current user
authRoutes.use('/me', authMiddleware);
authRoutes.openapi(currentUserRoute, async (c) => {
  const sessionUser = c.get('user')!;
  const authService = container.resolve(AuthService);
  const user = await authService.getUserById(sessionUser.id);
  const effectiveScopes = c.get('effectiveScopes') || user?.scopes || [];

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    groupId: user.groupId,
    groupName: user.groupName,
    scopes: effectiveScopes,
    isBlocked: user.isBlocked,
  });
});
