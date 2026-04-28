import { appRoute, pathParamSchema } from '@/lib/openapi.js';

const caParams = pathParamSchema('caId');
const ocspGetParams = pathParamSchema('caId', 'encodedRequest');

export const publicCrlRoute = appRoute({
  method: 'get',
  path: '/crl/{caId}',
  tags: ['PKI'],
  summary: 'Download a certificate revocation list',
  security: [],
  request: { params: caParams },
  responses: { 200: { description: 'DER-encoded CRL' } },
});

export const publicOcspPostRoute = appRoute({
  method: 'post',
  path: '/ocsp/{caId}',
  tags: ['PKI'],
  summary: 'Submit an OCSP request',
  security: [],
  request: { params: caParams },
  responses: { 501: { description: 'OCSP responder disabled' } },
});

export const publicOcspGetRoute = appRoute({
  method: 'get',
  path: '/ocsp/{caId}/{encodedRequest}',
  tags: ['PKI'],
  summary: 'Submit a base64-encoded OCSP request',
  security: [],
  request: { params: ocspGetParams },
  responses: { 501: { description: 'OCSP responder disabled' } },
});

export const publicCaCertificateRoute = appRoute({
  method: 'get',
  path: '/ca/{caId}/cert',
  tags: ['PKI'],
  summary: 'Download a CA certificate',
  security: [],
  request: { params: caParams },
  responses: { 200: { description: 'PEM CA certificate' } },
});
