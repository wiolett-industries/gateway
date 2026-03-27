import { z } from 'zod';

export const CreateRootCASchema = z.object({
  commonName: z.string().min(1).max(255),
  keyAlgorithm: z.enum(['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384']),
  validityYears: z.number().int().min(1).max(30),
  pathLengthConstraint: z.number().int().min(0).optional(),
  maxValidityDays: z.number().int().min(1).max(3650).default(365),
});

export const CreateIntermediateCASchema = z.object({
  commonName: z.string().min(1).max(255),
  keyAlgorithm: z.enum(['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384']),
  validityYears: z.number().int().min(1).max(20),
  pathLengthConstraint: z.number().int().min(0).optional(),
  maxValidityDays: z.number().int().min(1).max(3650).default(365),
});

export const RevokeCASchema = z.object({
  reason: z.string().min(1).max(255),
});

export const ExportCAKeySchema = z.object({
  passphrase: z.string().min(8),
});

export type CreateRootCAInput = z.infer<typeof CreateRootCASchema>;
export type CreateIntermediateCAInput = z.infer<typeof CreateIntermediateCASchema>;
