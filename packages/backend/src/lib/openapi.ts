import { z } from '@hono/zod-openapi';

export const ApiErrorSchema = z.object({
  code: z.string().openapi({
    description: 'Error code',
    example: 'VALIDATION_ERROR',
  }),
  message: z.string().openapi({
    description: 'Human-readable error message',
    example: 'Request validation failed',
  }),
  details: z.any().optional().openapi({
    description: 'Additional error details',
  }),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1).openapi({
    description: 'Page number (1-indexed)',
    example: 1,
  }),
  limit: z.coerce.number().min(1).max(100).default(20).openapi({
    description: 'Items per page',
    example: 20,
  }),
});

export const PaginationMetaSchema = z.object({
  page: z.number().openapi({ example: 1 }),
  limit: z.number().openapi({ example: 20 }),
  total: z.number().openapi({ example: 100 }),
  totalPages: z.number().openapi({ example: 5 }),
});

export const UUIDSchema = z.string().uuid().openapi({
  description: 'UUID v4 identifier',
  example: '550e8400-e29b-41d4-a716-446655440000',
});

export const TimestampSchema = z.string().datetime().openapi({
  description: 'ISO 8601 timestamp',
  example: '2024-01-01T12:00:00.000Z',
});

export const securitySchemes = {
  bearerAuth: {
    type: 'http' as const,
    scheme: 'bearer',
    description: 'Bearer token (session ID or API token)',
  },
};

export const tags = [
  { name: 'Authentication', description: 'User authentication via OIDC' },
  { name: 'Certificate Authorities', description: 'CA creation and management' },
  { name: 'Certificates', description: 'Certificate issuance, revocation, and export' },
  { name: 'Templates', description: 'Certificate template management' },
  { name: 'PKI', description: 'Public PKI endpoints (CRL, OCSP)' },
  { name: 'Audit', description: 'Audit log' },
  { name: 'Alerts', description: 'Expiry alerts and notifications' },
  { name: 'Tokens', description: 'API token management' },
  { name: 'Admin', description: 'User administration' },
];
