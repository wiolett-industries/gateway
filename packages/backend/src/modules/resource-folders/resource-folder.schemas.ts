import { z } from 'zod';

export const CreateResourceFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().uuid().optional(),
});

export const UpdateResourceFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

export const MoveResourceFolderSchema = z.object({
  parentId: z.string().uuid().nullable(),
});

export const ReorderResourceFoldersSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1),
});

export const MoveResourcesToFolderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  folderId: z.string().uuid().nullable(),
});

export const ReorderResourcesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1),
});

export type CreateResourceFolderInput = z.infer<typeof CreateResourceFolderSchema>;
export type UpdateResourceFolderInput = z.infer<typeof UpdateResourceFolderSchema>;
export type MoveResourceFolderInput = z.infer<typeof MoveResourceFolderSchema>;
export type ReorderResourceFoldersInput = z.infer<typeof ReorderResourceFoldersSchema>;
export type MoveResourcesToFolderInput = z.infer<typeof MoveResourcesToFolderSchema>;
export type ReorderResourcesInput = z.infer<typeof ReorderResourcesSchema>;
