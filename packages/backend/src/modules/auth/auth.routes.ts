import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { setCookie, deleteCookie } from 'hono/cookie';
import { container } from '@/container.js';
import { AuthService } from './auth.service.js';
import { authMiddleware, SESSION_COOKIE_NAME } from './auth.middleware.js';
import { getEnv, isDevelopment } from '@/config/env.js';
import type { AppEnv } from '@/types.js';

export const authRoutes = new OpenAPIHono<AppEnv>();

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
  const env = getEnv();
  const { state, error, error_description } = c.req.valid('query');

  if (error) {
    return c.json({ code: 'AUTH_ERROR', message: error_description || error }, 400);
  }

  try {
    const requestUrl = new URL(c.req.url);
    const callbackUrl = new URL(env.OIDC_REDIRECT_URI);
    callbackUrl.search = requestUrl.search;

    const result = await authService.handleCallback(callbackUrl.toString(), state);

    setCookie(c, SESSION_COOKIE_NAME, result.sessionId, {
      httpOnly: true,
      secure: !isDevelopment(),
      sameSite: 'Lax',
      maxAge: env.SESSION_EXPIRY,
      path: '/',
    });

    const baseUrl = result.returnTo || env.APP_URL;
    const redirectUrl = new URL('/callback', baseUrl);
    redirectUrl.searchParams.set('session', result.sessionId);
    return c.redirect(redirectUrl.toString(), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    return c.json({ code: 'AUTH_ERROR', message }, 400);
  }
});

// Logout
authRoutes.use('/logout', authMiddleware);
authRoutes.post('/logout', async (c) => {
  const authService = container.resolve(AuthService);
  const sessionId = c.get('sessionId')!;
  const logoutUrl = await authService.logout(sessionId);
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ message: 'Logged out successfully', logoutUrl });
});

// Get current user
authRoutes.use('/me', authMiddleware);
authRoutes.get('/me', async (c) => {
  const sessionUser = c.get('user')!;
  const authService = container.resolve(AuthService);
  const user = await authService.getUserById(sessionUser.id);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
  });
});
