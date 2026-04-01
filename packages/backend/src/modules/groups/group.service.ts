import { count, eq, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups, users } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { CreateGroupInput, UpdateGroupInput } from './group.schemas.js';

const logger = createChildLogger('GroupService');

@injectable()
export class GroupService {
  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  async listGroups() {
    const groups = await this.db
      .select({
        id: permissionGroups.id,
        name: permissionGroups.name,
        description: permissionGroups.description,
        isBuiltin: permissionGroups.isBuiltin,
        scopes: permissionGroups.scopes,
        createdAt: permissionGroups.createdAt,
        updatedAt: permissionGroups.updatedAt,
        memberCount: sql<number>`(SELECT count(*) FROM users WHERE users.group_id = "permission_groups"."id")::int`,
      })
      .from(permissionGroups)
      .orderBy(sql`${permissionGroups.isBuiltin} DESC`, sql`jsonb_array_length(${permissionGroups.scopes}) DESC`);

    return groups.map((g) => ({
      ...g,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    }));
  }

  async getGroup(id: string) {
    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, id),
    });

    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Permission group not found');
    }

    const [{ count: memberCount }] = await this.db.select({ count: count() }).from(users).where(eq(users.groupId, id));

    return {
      ...group,
      memberCount: Number(memberCount),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  async getGroupByName(name: string) {
    return this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.name, name),
    });
  }

  async createGroup(input: CreateGroupInput) {
    const existing = await this.getGroupByName(input.name);
    if (existing) {
      throw new AppError(409, 'GROUP_EXISTS', `Group "${input.name}" already exists`);
    }

    const [group] = await this.db
      .insert(permissionGroups)
      .values({
        name: input.name,
        description: input.description ?? null,
        isBuiltin: false,
        scopes: input.scopes,
      })
      .returning();

    logger.info('Created permission group', { groupId: group.id, name: group.name });

    return {
      ...group,
      memberCount: 0,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  async updateGroup(id: string, input: UpdateGroupInput) {
    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, id),
    });

    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Permission group not found');
    }

    if (group.isBuiltin) {
      throw new AppError(403, 'BUILTIN_GROUP', 'Cannot modify a built-in group');
    }

    if (input.name) {
      const existing = await this.getGroupByName(input.name);
      if (existing && existing.id !== id) {
        throw new AppError(409, 'GROUP_EXISTS', `Group "${input.name}" already exists`);
      }
    }

    const [updated] = await this.db
      .update(permissionGroups)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.scopes !== undefined && { scopes: input.scopes }),
        updatedAt: new Date(),
      })
      .where(eq(permissionGroups.id, id))
      .returning();

    logger.info('Updated permission group', { groupId: id, name: updated.name });

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteGroup(id: string) {
    const group = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, id),
    });

    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Permission group not found');
    }

    if (group.isBuiltin) {
      throw new AppError(403, 'BUILTIN_GROUP', 'Cannot delete a built-in group');
    }

    const [{ count: memberCount }] = await this.db.select({ count: count() }).from(users).where(eq(users.groupId, id));

    if (Number(memberCount) > 0) {
      throw new AppError(
        409,
        'GROUP_HAS_MEMBERS',
        `Cannot delete group with ${memberCount} assigned user(s). Reassign them first.`
      );
    }

    await this.db.delete(permissionGroups).where(eq(permissionGroups.id, id));
    logger.info('Deleted permission group', { groupId: id, name: group.name });
  }

  async getMemberIds(groupId: string): Promise<string[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.groupId, groupId));
    return rows.map((r) => r.id);
  }
}
