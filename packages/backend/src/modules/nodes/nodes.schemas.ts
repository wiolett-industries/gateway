import { z } from 'zod';

export const CreateNodeSchema = z.object({
  type: z.enum(['nginx', 'bastion', 'monitoring', 'docker']).default('nginx'),
  hostname: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
});

export const UpdateNodeSchema = z.object({
  displayName: z.string().max(255).optional(),
});

export const UpdateNodeServiceCreationLockSchema = z.object({
  serviceCreationLocked: z.boolean(),
});

export const NodeListQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(['nginx', 'bastion', 'monitoring', 'docker']).optional(),
  status: z.enum(['pending', 'online', 'offline', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;
export type UpdateNodeServiceCreationLockInput = z.infer<typeof UpdateNodeServiceCreationLockSchema>;
export type NodeListQuery = z.infer<typeof NodeListQuerySchema>;
