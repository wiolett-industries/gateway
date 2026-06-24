import { z } from '@hono/zod-openapi';
import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import {
  CreateResourceFolderSchema,
  MoveResourceFolderSchema,
  MoveResourcesToFolderSchema,
  ReorderResourceFoldersSchema,
  ReorderResourcesSchema,
  UpdateResourceFolderSchema,
} from '@/modules/resource-folders/resource-folder.schemas.js';
import { CreateGroupSchema, UpdateGroupSchema } from './group.schemas.js';

export const listGroupsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Admin'],
  summary: 'List permission groups',
  responses: okJson(UnknownDataResponseSchema),
});

export const listGroupFoldersRoute = appRoute({
  method: 'get',
  path: '/folders',
  tags: ['Admin Folders'],
  summary: 'List permission group folders',
  responses: okJson(UnknownDataResponseSchema),
});

export const createGroupFolderRoute = appRoute({
  method: 'post',
  path: '/folders',
  tags: ['Admin Folders'],
  summary: 'Create a permission group folder',
  request: jsonBody(CreateResourceFolderSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const reorderGroupFoldersRoute = appRoute({
  method: 'put',
  path: '/folders/reorder',
  tags: ['Admin Folders'],
  summary: 'Reorder permission group folders',
  request: jsonBody(ReorderResourceFoldersSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const moveGroupsToFolderRoute = appRoute({
  method: 'post',
  path: '/folders/move-groups',
  tags: ['Admin Folders'],
  summary: 'Move permission groups to a folder',
  request: jsonBody(MoveResourcesToFolderSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const reorderGroupsRoute = appRoute({
  method: 'put',
  path: '/folders/reorder-groups',
  tags: ['Admin Folders'],
  summary: 'Reorder permission groups',
  request: jsonBody(ReorderResourcesSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const updateGroupFolderRoute = appRoute({
  method: 'put',
  path: '/folders/{id}',
  tags: ['Admin Folders'],
  summary: 'Update a permission group folder',
  request: { params: IdParamSchema, ...jsonBody(UpdateResourceFolderSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const moveGroupFolderRoute = appRoute({
  method: 'put',
  path: '/folders/{id}/move',
  tags: ['Admin Folders'],
  summary: 'Move a permission group folder',
  request: { params: IdParamSchema, ...jsonBody(MoveResourceFolderSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteGroupFolderRoute = appRoute({
  method: 'delete',
  path: '/folders/{id}',
  tags: ['Admin Folders'],
  summary: 'Delete a permission group folder',
  request: { params: IdParamSchema },
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
