import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import { CreateDomainSchema, DomainListQuerySchema, UpdateDomainSchema } from './domain.schemas.js';

export const listDomainsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Domains'],
  summary: 'List domains',
  request: { query: DomainListQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const searchDomainsRoute = appRoute({
  method: 'get',
  path: '/search',
  tags: ['Domains'],
  summary: 'Search domains for autocomplete',
  responses: okJson(UnknownDataResponseSchema),
});

export const getDomainRoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Domains'],
  summary: 'Get domain details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createDomainRoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Domains'],
  summary: 'Create a domain',
  request: jsonBody(CreateDomainSchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateDomainRoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Domains'],
  summary: 'Update a domain',
  request: { params: IdParamSchema, ...jsonBody(UpdateDomainSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const deleteDomainRoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Domains'],
  summary: 'Delete a domain',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const checkDomainDnsRoute = appRoute({
  method: 'post',
  path: '/{id}/check-dns',
  tags: ['Domains'],
  summary: 'Run a DNS check for a domain',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const issueDomainCertificateRoute = appRoute({
  method: 'post',
  path: '/{id}/issue-cert',
  tags: ['Domains'],
  summary: 'Issue an ACME certificate for a domain',
  request: { params: IdParamSchema },
  responses: createdJson(UnknownDataResponseSchema),
});
