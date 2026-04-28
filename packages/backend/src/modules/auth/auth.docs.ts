import { z } from '@hono/zod-openapi';
import { appRoute, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

export const csrfTokenRoute = appRoute({
  method: 'get',
  path: '/csrf',
  tags: ['Authentication'],
  summary: 'Get CSRF token for the current session',
  responses: okJson(z.object({ csrfToken: z.string() })),
});

export const logoutRoute = appRoute({
  method: 'post',
  path: '/logout',
  tags: ['Authentication'],
  summary: 'Log out the current browser session',
  responses: okJson(z.object({ message: z.string(), logoutUrl: z.string().optional() })),
});

export const currentUserRoute = appRoute({
  method: 'get',
  path: '/me',
  tags: ['Authentication'],
  summary: 'Get the current authenticated user',
  responses: okJson(UnknownDataResponseSchema),
});
