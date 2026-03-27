import { z } from 'zod';

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  certType: z.enum(['tls-server', 'tls-client', 'code-signing', 'email']),
  keyAlgorithm: z.enum(['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384']).default('ecdsa-p256'),
  validityDays: z.number().int().min(1).max(3650).default(365),
  keyUsage: z.array(z.string()),
  extKeyUsage: z.array(z.string()),
  requireSans: z.boolean().default(true),
  sanTypes: z.array(z.enum(['dns', 'ip', 'email', 'uri'])).default(['dns', 'ip']),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;
