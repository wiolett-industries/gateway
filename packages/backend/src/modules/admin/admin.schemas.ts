import { z } from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  groupId: z.string().uuid(),
});

export const UpdateUserGroupSchema = z.object({
  groupId: z.string().uuid(),
});

export const UpdateBlockSchema = z.object({
  blocked: z.boolean(),
});

export type UpdateUserGroupInput = z.infer<typeof UpdateUserGroupSchema>;
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
