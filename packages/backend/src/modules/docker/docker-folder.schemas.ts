import { z } from 'zod';

export const CreateDockerFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().uuid().optional(),
});

export const UpdateDockerFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

export const DockerFolderContainerRefSchema = z.object({
  nodeId: z.string().uuid(),
  containerName: z.string().min(1).max(255),
});

export const MoveDockerContainersToFolderSchema = z.object({
  items: z.array(DockerFolderContainerRefSchema).min(1),
  folderId: z.string().uuid().nullable(),
});

export const ReorderDockerContainersSchema = z.object({
  items: z
    .array(
      DockerFolderContainerRefSchema.extend({
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1),
});

export const ReorderDockerFoldersSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1),
});

export type CreateDockerFolderInput = z.infer<typeof CreateDockerFolderSchema>;
export type UpdateDockerFolderInput = z.infer<typeof UpdateDockerFolderSchema>;
export type DockerFolderContainerRef = z.infer<typeof DockerFolderContainerRefSchema>;
export type MoveDockerContainersToFolderInput = z.infer<typeof MoveDockerContainersToFolderSchema>;
export type ReorderDockerContainersInput = z.infer<typeof ReorderDockerContainersSchema>;
export type ReorderDockerFoldersInput = z.infer<typeof ReorderDockerFoldersSchema>;
