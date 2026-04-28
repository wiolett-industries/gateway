import { appRoute, createdJson, IdParamSchema, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';
import {
  CreateIntermediateCASchema,
  CreateRootCASchema,
  ExportCAKeySchema,
  RevokeCASchema,
  UpdateCASchema,
} from './ca.schemas.js';

export const listCAsRoute = appRoute({
  method: 'get',
  path: '/',
  tags: ['Certificate Authorities'],
  summary: 'List certificate authorities',
  responses: okJson(UnknownDataResponseSchema),
});

export const getCARoute = appRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Certificate Authorities'],
  summary: 'Get certificate authority details',
  request: { params: IdParamSchema },
  responses: okJson(UnknownDataResponseSchema),
});

export const createRootCARoute = appRoute({
  method: 'post',
  path: '/',
  tags: ['Certificate Authorities'],
  summary: 'Create a root certificate authority',
  request: jsonBody(CreateRootCASchema),
  responses: createdJson(UnknownDataResponseSchema),
});

export const createIntermediateCARoute = appRoute({
  method: 'post',
  path: '/{id}/intermediate',
  tags: ['Certificate Authorities'],
  summary: 'Create an intermediate certificate authority',
  request: { params: IdParamSchema, ...jsonBody(CreateIntermediateCASchema) },
  responses: createdJson(UnknownDataResponseSchema),
});

export const updateCARoute = appRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Certificate Authorities'],
  summary: 'Update certificate authority settings',
  request: { params: IdParamSchema, ...jsonBody(UpdateCASchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const revokeCARoute = appRoute({
  method: 'post',
  path: '/{id}/revoke',
  tags: ['Certificate Authorities'],
  summary: 'Revoke a certificate authority',
  request: { params: IdParamSchema, ...jsonBody(RevokeCASchema) },
  responses: okJson(),
});

export const deleteCARoute = appRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Certificate Authorities'],
  summary: 'Delete a certificate authority',
  request: { params: IdParamSchema },
  responses: { 204: { description: 'No content' } },
});

export const exportCAKeyRoute = appRoute({
  method: 'post',
  path: '/{id}/export-key',
  tags: ['Certificate Authorities'],
  summary: 'Export a certificate authority private key',
  request: { params: IdParamSchema, ...jsonBody(ExportCAKeySchema) },
  responses: { 200: { description: 'PKCS#12 archive' } },
});

export const createOCSPResponderRoute = appRoute({
  method: 'post',
  path: '/{id}/ocsp-responder',
  tags: ['Certificate Authorities'],
  summary: 'Create an OCSP responder certificate',
  request: { params: IdParamSchema },
  responses: okJson(),
});
