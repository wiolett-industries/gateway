import { z } from 'zod';

export const UpdateUserRoleSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']),
});

export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleSchema>;
