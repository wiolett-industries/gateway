import { z } from 'zod';

export const WebhookUpsertSchema = z.object({
  enabled: z.boolean().optional(),
});

export const WebhookTriggerSchema = z.object({
  tag: z.string().min(1).optional(),
});
