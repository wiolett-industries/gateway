import {
  appRoute,
  createdJson,
  IdParamSchema,
  jsonBody,
  okJson,
  successJson,
  UnknownDataResponseSchema,
} from '@/lib/openapi.js';
import {
  CreateFolderSchema,
  GroupedHostsQuerySchema,
  MoveFolderSchema,
  MoveHostsToFolderSchema,
  ReorderFoldersSchema,
  ReorderHostsSchema,
  UpdateFolderSchema,
} from './folder.schemas.js';

export const listProxyFoldersRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Proxy Folders'],
  summary: 'List proxy host folders',
  responses: okJson(UnknownDataResponseSchema),
});
export const groupedProxyHostsRoute = appRoute({
  method: 'get',
  path: '/grouped',
  tags: ['Proxy Folders'],
  summary: 'List grouped proxy hosts and folders',
  request: { query: GroupedHostsQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const createProxyFolderRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Proxy Folders'],
  summary: 'Create a proxy host folder',
  request: jsonBody(CreateFolderSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const moveProxyHostsRoute = appRoute({
  method: 'post',
  path: '/move-hosts',
  tags: ['Proxy Folders'],
  summary: 'Move proxy hosts into a folder',
  request: jsonBody(MoveHostsToFolderSchema),
  responses: successJson,
});
export const reorderProxyFoldersRoute = appRoute({
  method: 'put',
  path: '/reorder',
  tags: ['Proxy Folders'],
  summary: 'Reorder proxy folders',
  request: jsonBody(ReorderFoldersSchema),
  responses: successJson,
});
export const reorderProxyHostsRoute = appRoute({
  method: 'put',
  path: '/reorder-hosts',
  tags: ['Proxy Folders'],
  summary: 'Reorder proxy hosts',
  request: jsonBody(ReorderHostsSchema),
  responses: successJson,
});
export const updateProxyFolderRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Proxy Folders'],
  summary: 'Update a proxy host folder',
  request: { params: IdParamSchema, ...jsonBody(UpdateFolderSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const moveProxyFolderRoute = appRoute({
  method: 'put',
  path: '/{id}/move',
  tags: ['Proxy Folders'],
  summary: 'Move a proxy host folder',
  request: { params: IdParamSchema, ...jsonBody(MoveFolderSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteProxyFolderRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Proxy Folders'],
  summary: 'Delete a proxy host folder',
  request: { params: IdParamSchema },
  responses: successJson,
});
export const cloneProxyFolderRoute = appRoute({
  method: 'post',
  path: '/{id}/clone',
  tags: ['Proxy Folders'],
  summary: 'Clone a proxy host folder',
  request: { params: IdParamSchema },
  responses: createdJson(UnknownDataResponseSchema),
});
