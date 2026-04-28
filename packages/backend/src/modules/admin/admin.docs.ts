import { z } from '@hono/zod-openapi';
import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import {
  CreateUserSchema,
  UpdateAuthProvisioningSettingsSchema,
  UpdateBlockSchema,
  UpdateUserGroupSchema,
} from './admin.schemas.js';

export const listAdminUsersRoute = appRoute({
  method: 'get',
  path: '/users',
  tags: ['Admin'],
  summary: 'List users',
  responses: okJson(UnknownDataResponseSchema),
});

export const getAuthSettingsRoute = appRoute({
  method: 'get',
  path: '/auth-settings',
  tags: ['Admin'],
  summary: 'Get authentication provisioning settings',
  responses: okJson(UnknownDataResponseSchema),
});

export const updateAuthSettingsRoute = appRoute({
  method: 'put',
  path: '/auth-settings',
  tags: ['Admin'],
  summary: 'Update authentication provisioning settings',
  request: jsonBody(UpdateAuthProvisioningSettingsSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const createAdminUserRoute = appRoute({
  method: 'post',
  path: '/users',
  tags: ['Admin'],
  summary: 'Create a user',
  request: jsonBody(CreateUserSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateUserGroupRoute = appRoute({
  method: 'patch',
  path: '/users/{id}/group',
  tags: ['Admin'],
  summary: 'Update a user permission group',
  request: { params: IdParamSchema, ...jsonBody(UpdateUserGroupSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const updateUserBlockRoute = appRoute({
  method: 'patch',
  path: '/users/{id}/block',
  tags: ['Admin'],
  summary: 'Block or unblock a user',
  request: { params: IdParamSchema, ...jsonBody(UpdateBlockSchema) },
  responses: okJson(z.object({ message: z.string() })),
});

export const deleteAdminUserRoute = appRoute({
  method: 'delete',
  path: '/users/{id}',
  tags: ['Admin'],
  summary: 'Delete a user',
  request: { params: IdParamSchema },
  responses: okJson(z.object({ message: z.string() })),
});
