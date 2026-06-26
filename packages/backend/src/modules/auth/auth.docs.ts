import { createRoute, z } from '@hono/zod-openapi';
import { appRoute, commonErrorResponses, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

const AIApprovalModeSchema = z.enum(['always-ask', 'normal', 'bypass-non-destructive', 'bypass-everything']);
const UserPreferencesSchema = z.object({
  aiApprovalMode: AIApprovalModeSchema,
});

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

export const currentUserPreferencesRoute = appRoute({
  method: 'get',
  path: '/me/preferences',
  tags: ['Authentication'],
  summary: 'Get current user preferences',
  responses: okJson(UserPreferencesSchema),
});

export const updateCurrentUserPreferencesRoute = createRoute({
  method: 'patch',
  path: '/me/preferences',
  tags: ['Authentication'],
  summary: 'Update current user preferences',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UserPreferencesSchema,
        },
      },
    },
  },
  responses: { ...okJson(UserPreferencesSchema), ...commonErrorResponses },
});
