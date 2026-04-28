import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import { CreateTemplateSchema, UpdateTemplateSchema } from './templates.schemas.js';

export const listTemplatesRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Templates'],
  summary: 'List certificate templates',
  responses: okJson(UnknownDataResponseSchema),
});

export const getTemplateRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Templates'],
  summary: 'Get certificate template details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createTemplateRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Templates'],
  summary: 'Create a certificate template',
  request: jsonBody(CreateTemplateSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateTemplateRoute = appRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Templates'],
  summary: 'Update a certificate template',
  request: { params: IdParamSchema, ...jsonBody(UpdateTemplateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteTemplateRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Templates'],
  summary: 'Delete a certificate template',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});
