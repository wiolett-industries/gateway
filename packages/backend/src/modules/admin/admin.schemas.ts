import { z } from 'zod';

export const UpdateUserGroupSchema = z.object({
  groupId: z.string().uuid(),
});

export const UpdateBlockSchema = z.object({
  blocked: z.boolean(),
});

export type UpdateUserGroupInput = z.infer<typeof UpdateUserGroupSchema>;
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;
