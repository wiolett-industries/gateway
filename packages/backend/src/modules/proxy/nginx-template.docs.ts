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
  CreateNginxTemplateSchema,
  PreviewNginxTemplateSchema,
  UpdateNginxTemplateSchema,
} from './nginx-template.schemas.js';

export const listNginxTemplatesRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Nginx Templates'],
  summary: 'List nginx templates',
  responses: okJson(UnknownDataResponseSchema),
});
export const getNginxTemplateRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Nginx Templates'],
  summary: 'Get an nginx template',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const createNginxTemplateRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Nginx Templates'],
  summary: 'Create an nginx template',
  request: jsonBody(CreateNginxTemplateSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const updateNginxTemplateRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Nginx Templates'],
  summary: 'Update an nginx template',
  request: { params: IdParamSchema, ...jsonBody(UpdateNginxTemplateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteNginxTemplateRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Nginx Templates'],
  summary: 'Delete an nginx template',
  request: { params: IdParamSchema },
  responses: successJson,
});
export const cloneNginxTemplateRoute = appRoute({
  method: 'post',
  path: '/{id}/clone',
  tags: ['Nginx Templates'],
  summary: 'Clone an nginx template',
  request: { params: IdParamSchema },
  responses: createdJson(UnknownDataResponseSchema),
});
export const previewNginxTemplateRoute = appRoute({
  method: 'post',
  path: '/preview',
  tags: ['Nginx Templates'],
  summary: 'Preview rendered nginx template config',
  request: jsonBody(PreviewNginxTemplateSchema),
  responses: okJson(UnknownDataResponseSchema),
});
export const testNginxTemplateRoute = appRoute({
  method: 'post',
  path: '/test',
  tags: ['Nginx Templates'],
  summary: 'Test nginx template config',
  request: jsonBody(PreviewNginxTemplateSchema),
  responses: okJson(UnknownDataResponseSchema),
});
