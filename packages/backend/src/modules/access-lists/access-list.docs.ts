import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import { AccessListQuerySchema, CreateAccessListSchema, UpdateAccessListSchema } from './access-list.schemas.js';

export const listAccessListsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Access Lists'],
  summary: 'List access lists',
  request: { query: AccessListQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const getAccessListRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Access Lists'],
  summary: 'Get access list details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createAccessListRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Access Lists'],
  summary: 'Create an access list',
  request: jsonBody(CreateAccessListSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateAccessListRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Access Lists'],
  summary: 'Update an access list',
  request: { params: IdParamSchema, ...jsonBody(UpdateAccessListSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteAccessListRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Access Lists'],
  summary: 'Delete an access list',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});
