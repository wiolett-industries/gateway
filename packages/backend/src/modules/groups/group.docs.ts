import { z } from '@hono/zod-openapi';
import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import { CreateGroupSchema, UpdateGroupSchema } from './group.schemas.js';

export const listGroupsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Admin'],
  summary: 'List permission groups',
  responses: okJson(UnknownDataResponseSchema),
});

export const getGroupRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Admin'],
  summary: 'Get permission group details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createGroupRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Admin'],
  summary: 'Create a permission group',
  request: jsonBody(CreateGroupSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateGroupRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Admin'],
  summary: 'Update a permission group',
  request: { params: IdParamSchema, ...jsonBody(UpdateGroupSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteGroupRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Admin'],
  summary: 'Delete a permission group',
  request: { params: IdParamSchema },
  responses: okJson(z.object({ message: z.string() })),
});
