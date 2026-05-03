import { z } from 'zod';

export const ImageCleanupUpsertSchema = z.object({
  enabled: z.boolean().optional(),
  retentionCount: z.number().int().min(1).max(50).optional(),
});

export type ImageCleanupUpsertInput = z.infer<typeof ImageCleanupUpsertSchema>;
