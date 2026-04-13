import { z } from 'zod';
import { isPrivateUrl } from '@/lib/utils.js';

export const WebhookListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  enabled: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export type WebhookListQuery = z.infer<typeof WebhookListQuerySchema>;

const safeUrl = z.string().url().max(2048).refine((u) => !isPrivateUrl(u), {
  message: 'Webhook URL must not point to a private or internal address',
});

export const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(255),
  url: safeUrl,
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  enabled: z.boolean().default(true),
  signingSecret: z.string().max(500).optional(),
  signingHeader: z.string().max(100).default('X-Signature-256'),
  templatePreset: z.string().max(50).nullable().optional(),
  bodyTemplate: z.string().max(65536).optional(),
  headers: z.record(z.string(), z.string()).default({}),
});

export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: safeUrl.optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).optional(),
  enabled: z.boolean().optional(),
  signingSecret: z.string().max(500).nullable().optional(),
  signingHeader: z.string().max(100).optional(),
  templatePreset: z.string().max(50).nullable().optional(),
  bodyTemplate: z.string().max(65536).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;
