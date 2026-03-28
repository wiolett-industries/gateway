import { z } from 'zod';

const domainRegex = /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export const RequestACMECertSchema = z.object({
  domains: z
    .array(z.string().regex(domainRegex, 'Invalid domain format'))
    .min(1, 'At least one domain is required'),
  challengeType: z.enum(['http-01', 'dns-01']),
  provider: z.enum(['letsencrypt', 'letsencrypt-staging']).default('letsencrypt'),
  autoRenew: z.boolean().optional(),
}).transform((data) => ({
  ...data,
  autoRenew: data.autoRenew ?? (data.challengeType === 'http-01'),
}));

export const UploadCertSchema = z.object({
  name: z.string().min(1).max(255),
  certificatePem: z
    .string()
    .refine((v) => v.trimStart().startsWith('-----BEGIN CERTIFICATE-----'), {
      message: 'Certificate must start with -----BEGIN CERTIFICATE-----',
    }),
  privateKeyPem: z
    .string()
    .refine((v) => v.trimStart().startsWith('-----BEGIN'), {
      message: 'Private key must start with -----BEGIN',
    }),
  chainPem: z.string().optional(),
});

export const LinkInternalCertSchema = z.object({
  internalCertId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
});

export const SSLCertListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  type: z.enum(['acme', 'upload', 'internal']).optional(),
  status: z.enum(['active', 'expired', 'pending', 'error']).optional(),
  search: z.string().optional(),
});

export type RequestACMECertInput = z.output<typeof RequestACMECertSchema>;
export type UploadCertInput = z.infer<typeof UploadCertSchema>;
export type LinkInternalCertInput = z.infer<typeof LinkInternalCertSchema>;
export type SSLCertListQuery = z.infer<typeof SSLCertListQuerySchema>;
