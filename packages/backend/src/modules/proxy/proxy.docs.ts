import {
  appRoute,
  createdJson,
  dataResponseSchema,
  IdParamSchema,
  jsonBody,
  okJson,
  UnknownDataResponseSchema,
} from '@/lib/openapi.js';
import {
  CreateProxyHostSchema,
  ProxyHostListQuerySchema,
  ToggleProxyHostSchema,
  UpdateProxyHostSchema,
  ValidateAdvancedConfigSchema,
} from './proxy.schemas.js';

const RenderedConfigResponseSchema = dataResponseSchema(
  ValidateAdvancedConfigSchema.pick({ snippet: true })
    .extend({
      rendered: ValidateAdvancedConfigSchema.shape.snippet,
    })
    .omit({ snippet: true })
);

export const listProxyHostsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Proxy Hosts'],
  summary: 'List proxy hosts',
  request: { query: ProxyHostListQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const getProxyHostRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Proxy Hosts'],
  summary: 'Get proxy host details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createProxyHostRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Proxy Hosts'],
  summary: 'Create a proxy host',
  request: jsonBody(CreateProxyHostSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateProxyHostRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Proxy Hosts'],
  summary: 'Update a proxy host',
  request: { params: IdParamSchema, ...jsonBody(UpdateProxyHostSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteProxyHostRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Proxy Hosts'],
  summary: 'Delete a proxy host',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});

export const toggleProxyHostRoute = appRoute({
  method: 'post',
  path: '/{id}/toggle',
  tags: ['Proxy Hosts'],
  summary: 'Enable or disable a proxy host',
  request: { params: IdParamSchema, ...jsonBody(ToggleProxyHostSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const renderedProxyConfigRoute = appRoute({
  method: 'get',
  path: '/{id}/rendered-config',
  tags: ['Proxy Hosts'],
  summary: 'Get rendered nginx config for a proxy host',
  request: { params: IdParamSchema },
  responses: okJson(RenderedConfigResponseSchema),
});

export const validateProxyConfigRoute = appRoute({
  method: 'post',
  path: '/validate-config',
  tags: ['Proxy Hosts'],
  summary: 'Validate advanced nginx config',
  request: jsonBody(ValidateAdvancedConfigSchema),
  responses: okJson(UnknownDataResponseSchema),
});
