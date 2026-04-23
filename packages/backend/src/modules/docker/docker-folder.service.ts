import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerContainerFolderAssignments, dockerContainerFolders } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type {
  CreateDockerFolderInput,
  MoveDockerContainersToFolderInput,
  ReorderDockerFoldersInput,
  ReorderDockerContainersInput,
  UpdateDockerFolderInput,
} from './docker-folder.schemas.js';

const logger = createChildLogger('DockerFolderService');
const MAX_DEPTH = 2;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

type FolderRow = typeof dockerContainerFolders.$inferSelect;
type AssignmentRow = typeof dockerContainerFolderAssignments.$inferSelect;

type DockerContainerLike = {
  id?: string;
  Id?: string;
  name?: string;
  Name?: string;
  labels?: Record<string, string>;
  Labels?: Record<string, string>;
  [key: string]: unknown;
};

export interface DockerFolderTreeNode extends FolderRow {
  children: DockerFolderTreeNode[];
}

function getContainerName(container: DockerContainerLike): string {
  return String(container.name ?? container.Name ?? '').replace(/^\//, '');
}

function getContainerLabels(container: DockerContainerLike): Record<string, string> {
  return (container.labels ?? container.Labels ?? {}) as Record<string, string>;
}

function getComposeProject(container: DockerContainerLike): string | null {
  return getContainerLabels(container)['com.docker.compose.project'] ?? null;
}

function getComposeService(container: DockerContainerLike): string | null {
  return getContainerLabels(container)['com.docker.compose.service'] ?? null;
}

function sortComposeContainers(containers: DockerContainerLike[]): DockerContainerLike[] {
  return [...containers].sort((a, b) => {
    const sa = getComposeService(a) ?? getContainerName(a);
    const sb = getComposeService(b) ?? getContainerName(b);
    return sa.localeCompare(sb);
  });
}

export class DockerFolderService {
  private eventBus?: EventBusService;

  constructor(
    private readonly db: DrizzleClient,
    private readonly auditService: AuditService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  private emitLayoutChanged(action: string, folderId?: string | null) {
    this.eventBus?.publish('docker.folder.changed', { action, folderId });
  }

  private async getNextSortOrder(parentId: string | null): Promise<number> {
    const siblings = await this.db
      .select({ sortOrder: dockerContainerFolders.sortOrder })
      .from(dockerContainerFolders)
      .where(parentId ? eq(dockerContainerFolders.parentId, parentId) : isNull(dockerContainerFolders.parentId))
      .orderBy(desc(dockerContainerFolders.sortOrder))
      .limit(1);

    return siblings.length > 0 ? siblings[0].sortOrder + 1 : 0;
  }

  private async getFolderOrThrow(id: string): Promise<FolderRow> {
    const folder = await this.db.query.dockerContainerFolders.findFirst({
      where: eq(dockerContainerFolders.id, id),
    });
    if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder not found');
    return folder;
  }

  private assertFolderMutable(folder: FolderRow) {
    if (folder.isSystem) {
      throw new AppError(400, 'SYSTEM_FOLDER_LOCKED', 'Protected compose deployment folders cannot be modified');
    }
  }

  async createFolder(input: CreateDockerFolderInput, userId: string) {
    let depth = 0;

    if (input.parentId) {
      const parent = await this.getFolderOrThrow(input.parentId);
      this.assertFolderMutable(parent);
      if (parent.depth >= MAX_DEPTH) {
        throw new AppError(400, 'MAX_DEPTH_EXCEEDED', `Maximum folder nesting depth is ${MAX_DEPTH + 1} levels`);
      }
      depth = parent.depth + 1;
    }

    const [folder] = await this.db
      .insert(dockerContainerFolders)
      .values({
        name: input.name,
        parentId: input.parentId ?? null,
        sortOrder: await this.getNextSortOrder(input.parentId ?? null),
        depth,
        createdById: userId,
      })
      .returning();

    await this.auditService.log({
      userId,
      action: 'docker_folder.create',
      resourceType: 'docker_folder',
      resourceId: folder.id,
      details: { name: folder.name, parentId: folder.parentId },
    });

    this.emitLayoutChanged('folder_created', folder.id);
    return folder;
  }

  async updateFolder(id: string, input: UpdateDockerFolderInput, userId: string) {
    const folder = await this.getFolderOrThrow(id);
    this.assertFolderMutable(folder);

    const [updated] = await this.db
      .update(dockerContainerFolders)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(dockerContainerFolders.id, id))
      .returning();

    await this.auditService.log({
      userId,
      action: 'docker_folder.update',
      resourceType: 'docker_folder',
      resourceId: id,
      details: { oldName: folder.name, newName: input.name },
    });

    this.emitLayoutChanged('folder_updated', id);
    return updated;
  }

  async deleteFolder(id: string, userId: string) {
    const folder = await this.getFolderOrThrow(id);
    this.assertFolderMutable(folder);

    await this.db.delete(dockerContainerFolders).where(eq(dockerContainerFolders.id, id));

    await this.auditService.log({
      userId,
      action: 'docker_folder.delete',
      resourceType: 'docker_folder',
      resourceId: id,
      details: { name: folder.name },
    });

    this.emitLayoutChanged('folder_deleted', id);
  }

  async reorderFolders(input: ReorderDockerFoldersInput, userId: string) {
    const folders = await this.db
      .select()
      .from(dockerContainerFolders)
      .where(inArray(dockerContainerFolders.id, input.items.map((item) => item.id)));

    if (folders.length !== input.items.length) {
      throw new AppError(404, 'FOLDER_NOT_FOUND', 'One or more folders were not found');
    }

    if (folders.some((folder) => folder.isSystem)) {
      throw new AppError(
        400,
        'SYSTEM_FOLDER_LOCKED',
        'Protected compose deployment folders cannot be reordered manually'
      );
    }

    const parentIds = [...new Set(folders.map((folder) => folder.parentId ?? null))];
    if (parentIds.length > 1) {
      throw new AppError(400, 'INVALID_REORDER', 'Folders can only be reordered within the same parent');
    }

    for (const item of input.items) {
      await this.db
        .update(dockerContainerFolders)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(dockerContainerFolders.id, item.id));
    }

    await this.auditService.log({
      userId,
      action: 'docker_folder.reorder',
      resourceType: 'docker_folder',
      details: { items: input.items },
    });

    this.emitLayoutChanged('folders_reordered');
  }

  async getFolderTree(): Promise<DockerFolderTreeNode[]> {
    const allFolders = await this.db
      .select()
      .from(dockerContainerFolders)
      .orderBy(asc(dockerContainerFolders.depth), asc(dockerContainerFolders.sortOrder));

    return this.buildTree(allFolders);
  }

  async moveContainersToFolder(input: MoveDockerContainersToFolderInput, userId: string) {
    let targetFolder: FolderRow | null = null;
    if (input.folderId) {
      targetFolder = await this.getFolderOrThrow(input.folderId);
      if (targetFolder.isSystem) {
        throw new AppError(
          400,
          'SYSTEM_FOLDER_LOCKED',
          'Containers cannot be moved into protected compose deployment folders'
        );
      }
    }

    const assignmentRows = await this.getAssignmentsForRefs(input.items);
    const sourceFolderIds = [...new Set(assignmentRows.map((row) => row.folderId).filter((id): id is string => !!id))];
    if (sourceFolderIds.length > 0) {
      const sourceFolders = await this.db
        .select({ id: dockerContainerFolders.id, isSystem: dockerContainerFolders.isSystem })
        .from(dockerContainerFolders)
        .where(inArray(dockerContainerFolders.id, sourceFolderIds));
      if (sourceFolders.some((folder) => folder.isSystem)) {
        throw new AppError(
          400,
          'SYSTEM_FOLDER_LOCKED',
          'Containers cannot be moved out of protected compose deployment folders'
        );
      }
    }

    if (!targetFolder) {
      const byNode = new Map<string, string[]>();
      for (const item of input.items) {
        const current = byNode.get(item.nodeId) ?? [];
        current.push(item.containerName);
        byNode.set(item.nodeId, current);
      }

      for (const [nodeId, names] of byNode.entries()) {
        const maxSort = await this.db
          .select({ sortOrder: dockerContainerFolderAssignments.sortOrder })
          .from(dockerContainerFolderAssignments)
          .where(and(eq(dockerContainerFolderAssignments.nodeId, nodeId), isNull(dockerContainerFolderAssignments.folderId)))
          .orderBy(desc(dockerContainerFolderAssignments.sortOrder))
          .limit(1);
        let nextSortOrder = maxSort.length > 0 ? maxSort[0].sortOrder + 1 : 0;

        for (const name of names) {
          await this.db
            .insert(dockerContainerFolderAssignments)
            .values({
              nodeId,
              containerName: name,
              folderId: null,
              sortOrder: nextSortOrder++,
            })
            .onConflictDoUpdate({
              target: [
                dockerContainerFolderAssignments.nodeId,
                dockerContainerFolderAssignments.containerName,
              ],
              set: {
                folderId: null,
                sortOrder: nextSortOrder - 1,
                updatedAt: new Date(),
              },
            });
        }
      }
    } else {
      const maxSort = await this.db
        .select({ sortOrder: dockerContainerFolderAssignments.sortOrder })
        .from(dockerContainerFolderAssignments)
        .where(eq(dockerContainerFolderAssignments.folderId, targetFolder.id))
        .orderBy(desc(dockerContainerFolderAssignments.sortOrder))
        .limit(1);
      let nextSortOrder = maxSort.length > 0 ? maxSort[0].sortOrder + 1 : 0;

      for (const item of input.items) {
        await this.db
          .insert(dockerContainerFolderAssignments)
          .values({
            nodeId: item.nodeId,
            containerName: item.containerName,
            folderId: targetFolder.id,
            sortOrder: nextSortOrder++,
          })
          .onConflictDoUpdate({
            target: [
              dockerContainerFolderAssignments.nodeId,
              dockerContainerFolderAssignments.containerName,
            ],
            set: {
              folderId: targetFolder.id,
              sortOrder: nextSortOrder - 1,
              updatedAt: new Date(),
            },
          });
      }
    }

    await this.auditService.log({
      userId,
      action: 'docker_container.move_to_folder',
      resourceType: 'docker-container',
      details: { items: input.items, folderId: input.folderId },
    });

    this.emitLayoutChanged('containers_moved', input.folderId);
  }

  async reorderContainers(input: ReorderDockerContainersInput, userId: string) {
    const assignmentRows = await this.getAssignmentsForRefs(input.items);
    if (assignmentRows.length !== input.items.length) {
      throw new AppError(400, 'INVALID_REORDER', 'All containers must have persisted placement before reordering');
    }

    const folderIds = [...new Set(assignmentRows.map((row) => row.folderId ?? null))];
    if (folderIds.length > 1) {
      throw new AppError(400, 'INVALID_REORDER', 'Containers can only be reordered within the same parent section');
    }

    const nonNullFolderIds = folderIds.filter((id): id is string => !!id);
    if (nonNullFolderIds.length > 0) {
      const folders = await this.db
        .select({ id: dockerContainerFolders.id, isSystem: dockerContainerFolders.isSystem })
        .from(dockerContainerFolders)
        .where(inArray(dockerContainerFolders.id, nonNullFolderIds));

      if (folders.some((folder) => folder.isSystem)) {
        throw new AppError(
          400,
          'SYSTEM_FOLDER_LOCKED',
          'Protected compose deployment folders cannot be reordered manually'
        );
      }
    }

    for (const item of input.items) {
      await this.db
        .update(dockerContainerFolderAssignments)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(dockerContainerFolderAssignments.nodeId, item.nodeId),
            eq(dockerContainerFolderAssignments.containerName, item.containerName)
          )
        );
    }

    await this.auditService.log({
      userId,
      action: 'docker_container.reorder_in_folder',
      resourceType: 'docker-container',
      details: { items: input.items },
    });

    this.emitLayoutChanged('containers_reordered');
  }

  async syncNodeContainers(nodeId: string, containers: DockerContainerLike[]) {
    const normalized = containers
      .map((container) => ({
        name: getContainerName(container),
        project: getComposeProject(container),
        service: getComposeService(container),
      }))
      .filter((container) => container.name !== '');

    const activeNames = normalized.map((container) => container.name);
    const composeGroups = new Map<string, Array<{ name: string; service: string | null }>>();
    for (const container of normalized) {
      if (!container.project) continue;
      const group = composeGroups.get(container.project) ?? [];
      group.push({ name: container.name, service: container.service });
      composeGroups.set(container.project, group);
    }

    const existingSystemFolders = await this.db
      .select()
      .from(dockerContainerFolders)
      .where(and(eq(dockerContainerFolders.nodeId, nodeId), eq(dockerContainerFolders.isSystem, true)));

    const activeProjects = [...composeGroups.keys()];
    const staleSystemFolders = existingSystemFolders.filter(
      (folder) => folder.composeProject && !activeProjects.includes(folder.composeProject)
    );
    if (staleSystemFolders.length > 0) {
      await this.db.delete(dockerContainerFolders).where(inArray(dockerContainerFolders.id, staleSystemFolders.map((f) => f.id)));
    }

    const systemFoldersByProject = new Map<string, FolderRow>();
    for (const folder of existingSystemFolders) {
      if (folder.composeProject && activeProjects.includes(folder.composeProject)) {
        systemFoldersByProject.set(folder.composeProject, folder);
      }
    }

    for (const project of activeProjects) {
      if (systemFoldersByProject.has(project)) continue;
      const [created] = await this.db
        .insert(dockerContainerFolders)
        .values({
          name: project,
          parentId: null,
          sortOrder: await this.getNextSortOrder(null),
          depth: 0,
          isSystem: true,
          nodeId,
          composeProject: project,
          createdById: SYSTEM_USER_ID,
        })
        .returning();
      systemFoldersByProject.set(project, created);
    }

    if (activeNames.length === 0) {
      await this.db.delete(dockerContainerFolderAssignments).where(eq(dockerContainerFolderAssignments.nodeId, nodeId));
    } else {
      await this.db
        .delete(dockerContainerFolderAssignments)
        .where(
          and(
            eq(dockerContainerFolderAssignments.nodeId, nodeId),
            notInArray(dockerContainerFolderAssignments.containerName, activeNames)
          )
        );
    }

    for (const [project, group] of composeGroups.entries()) {
      const folder = systemFoldersByProject.get(project);
      if (!folder) continue;
      const sorted = [...group].sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name));
      for (const [index, container] of sorted.entries()) {
        await this.db
          .insert(dockerContainerFolderAssignments)
          .values({
            nodeId,
            containerName: container.name,
            folderId: folder.id,
            sortOrder: index,
          })
          .onConflictDoUpdate({
            target: [
              dockerContainerFolderAssignments.nodeId,
              dockerContainerFolderAssignments.containerName,
            ],
            set: {
              folderId: folder.id,
              sortOrder: index,
              updatedAt: new Date(),
            },
          });
      }
    }

    const folderRows = await this.db.select().from(dockerContainerFolders);
    const folderById = new Map(folderRows.map((folder) => [folder.id, folder]));

    const assignments = await this.db
      .select()
      .from(dockerContainerFolderAssignments)
      .where(eq(dockerContainerFolderAssignments.nodeId, nodeId));

    const assignmentByName = new Map(assignments.map((assignment) => [assignment.containerName, assignment]));

    return normalized.map((container) => {
      const assignment = assignmentByName.get(container.name);
      const folder = assignment?.folderId ? folderById.get(assignment.folderId) : undefined;
      return {
        containerName: container.name,
        folderId: assignment?.folderId ?? null,
        folderIsSystem: folder?.isSystem ?? false,
        sortOrder: assignment?.sortOrder ?? 0,
      };
    });
  }

  async renameContainerAssignment(nodeId: string, oldName: string, newName: string) {
    if (oldName === newName) return;
    const assignment = await this.db.query.dockerContainerFolderAssignments.findFirst({
      where: and(
        eq(dockerContainerFolderAssignments.nodeId, nodeId),
        eq(dockerContainerFolderAssignments.containerName, oldName)
      ),
    });
    if (!assignment) return;

    await this.db
      .delete(dockerContainerFolderAssignments)
      .where(
        and(
          eq(dockerContainerFolderAssignments.nodeId, nodeId),
          eq(dockerContainerFolderAssignments.containerName, newName)
        )
      );

    await this.db
      .update(dockerContainerFolderAssignments)
      .set({ containerName: newName, updatedAt: new Date() })
      .where(eq(dockerContainerFolderAssignments.id, assignment.id));
  }

  async deleteContainerAssignment(nodeId: string, containerName: string) {
    await this.db
      .delete(dockerContainerFolderAssignments)
      .where(
        and(
          eq(dockerContainerFolderAssignments.nodeId, nodeId),
          eq(dockerContainerFolderAssignments.containerName, containerName)
        )
      );
  }

  private async getAssignmentsForRefs(items: Array<{ nodeId: string; containerName: string }>): Promise<AssignmentRow[]> {
    const byNode = new Map<string, string[]>();
    for (const item of items) {
      const list = byNode.get(item.nodeId) ?? [];
      list.push(item.containerName);
      byNode.set(item.nodeId, list);
    }

    const rows: AssignmentRow[] = [];
    for (const [nodeId, names] of byNode.entries()) {
      const found = await this.db
        .select()
        .from(dockerContainerFolderAssignments)
        .where(
          and(
            eq(dockerContainerFolderAssignments.nodeId, nodeId),
            inArray(dockerContainerFolderAssignments.containerName, [...new Set(names)])
          )
        );
      rows.push(...found);
    }
    return rows;
  }

  private buildTree(folders: FolderRow[]): DockerFolderTreeNode[] {
    const nodeMap = new Map<string, DockerFolderTreeNode>();
    for (const folder of folders) {
      nodeMap.set(folder.id, { ...folder, children: [] });
    }

    const roots: DockerFolderTreeNode[] = [];
    for (const folder of folders) {
      const node = nodeMap.get(folder.id)!;
      if (folder.parentId && nodeMap.has(folder.parentId)) {
        nodeMap.get(folder.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}
