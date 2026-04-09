import { z } from 'zod';

export const WebhookUpsertSchema = z.object({
  cleanupEnabled: z.boolean().optional(),
  retentionCount: z.number().int().min(1).max(50).optional(),
});

export const WebhookTriggerSchema = z.object({
  tag: z.string().min(1).optional(),
});
