import { z } from 'zod';
import { BUILTIN_GROUP_NAMES, isValidBaseScope } from '@/lib/scopes.js';

const scopeString = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(:[a-zA-Z0-9-]+)*$/,
    'Invalid scope format'
  )
  .refine(isValidBaseScope, 'Unrecognized base scope');

export const CreateGroupSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Name must be lowercase alphanumeric with hyphens')
    .refine(
      (name) => !BUILTIN_GROUP_NAMES.includes(name),
      'Cannot use a built-in group name'
    ),
  description: z.string().max(500).optional(),
  scopes: z.array(scopeString).min(1, 'At least one scope is required'),
});

export const UpdateGroupSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Name must be lowercase alphanumeric with hyphens')
    .refine(
      (name) => !BUILTIN_GROUP_NAMES.includes(name),
      'Cannot use a built-in group name'
    )
    .optional(),
  description: z.string().max(500).nullable().optional(),
  scopes: z.array(scopeString).min(1, 'At least one scope is required').optional(),
});

export const AssignGroupSchema = z.object({
  groupId: z.string().uuid(),
});

export const GroupResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isBuiltin: z.boolean(),
  scopes: z.array(z.string()),
  memberCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;
