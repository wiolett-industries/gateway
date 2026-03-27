import { z } from 'zod';

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
