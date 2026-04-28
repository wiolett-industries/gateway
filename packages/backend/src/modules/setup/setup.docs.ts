import { z } from '@hono/zod-openapi';
import { appRoute, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

const ManagementSslSchema = z.object({
  domain: z.string().min(1),
});

const EnrollNodeSchema = z.object({
  type: z.enum(['nginx', 'bastion', 'monitoring', 'docker']).optional(),
  hostname: z.string().optional(),
});

const ManagementSslUploadSchema = z.object({
  domain: z.string().min(1),
  certificatePem: z.string().min(1),
  privateKeyPem: z.string().min(1),
  chainPem: z.string().optional(),
});

export const setupManagementSslRoute = appRoute({
  method: 'post',
  path: '/management-ssl',
  tags: ['Setup'],
  summary: 'Bootstrap management SSL with ACME',
  security: [{ bearerAuth: [] }],
  request: jsonBody(ManagementSslSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const setupEnrollNodeRoute = appRoute({
  method: 'post',
  path: '/enroll-node',
  tags: ['Setup'],
  summary: 'Enroll a node during initial setup',
  security: [{ bearerAuth: [] }],
  request: jsonBody(EnrollNodeSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const setupManagementSslUploadRoute = appRoute({
  method: 'post',
  path: '/management-ssl-upload',
  tags: ['Setup'],
  summary: 'Bootstrap management SSL with an uploaded certificate',
  security: [{ bearerAuth: [] }],
  request: jsonBody(ManagementSslUploadSchema),
  responses: okJson(UnknownDataResponseSchema),
});
