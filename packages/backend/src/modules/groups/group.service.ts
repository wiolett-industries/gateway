import { count, eq, inArray, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups, users } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope, isScopeSubset } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
import { computeEffectiveGroupAccess, fetchGroupScopeMap } from '@/modules/auth/live-session-user.js';
import type { CreateGroupInput, UpdateGroupInput } from './group.schemas.js';

const logger = createChildLogger('GroupService');

function disallowedScopes(effectiveScopes: string[], actorScopes: string[]) {
  return effectiveScopes.filter((scope) => !hasScope(actorScopes, scope));
}

@injectable()
export class GroupService {
  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  private eventBus?: import('@/services/event-bus.service.js').EventBusService;
  setEventBus(bus: import('@/services/event-bus.service.js').EventBusService) {
    this.eventBus = bus;
  }
  private emitGroup(id: string, action: 'created' | 'updated' | 'deleted') {
    this.eventBus?.publish('group.changed', { id, action });
  }

  private collectDescendantGroupIds(
    groupId: string,
    groupMap: Map<string, { id: string; parentId: string | null }>
  ): string[] {
    const descendants: string[] = [];
    const queue = [groupId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const group of groupMap.values()) {
        if (group.parentId !== current) continue;
        descendants.push(group.id);
        queue.push(group.id);
      }
    }

    return descendants;
  }

  /** Cascade a permissions change to every user in the affected group tree. */
  private async cascadePermissions(groupId: string) {
    if (!this.eventBus) return;

    const allGroups = await this.db
      .select({ id: permissionGroups.id, parentId: permissionGroups.parentId })
      .from(permissionGroups);
    const groupMap = new Map(allGroups.map((group) => [group.id, group]));
    const affectedGroupIds = [groupId, ...this.collectDescendantGroupIds(groupId, groupMap)];

    const affected = await this.db.select({ id: users.id }).from(users).where(inArray(users.groupId, affectedGroupIds));

    for (const u of affected) {
      this.eventBus.publish(`permissions.changed.${u.id}`, { groupId });
    }
  }

  async getEffectiveScopesForGroupId(groupId: string): Promise<string[]> {
    const groupMap = await fetchGroupScopeMap(this.db);
    return computeEffectiveGroupAccess(groupId, groupMap).scopes;
  }

  async buildEffectiveScopes(scopes: string[], parentId: string | null | undefined): Promise<string[]> {
    const directScopes = [...new Set(scopes)];
    if (!parentId) return directScopes;

    const parentScopes = await this.getEffectiveScopesForGroupId(parentId);
    return [...new Set([...directScopes, ...parentScopes])];
  }

  async assertCanCreateGroup(input: CreateGroupInput, actorScopes: string[]): Promise<void> {
    const effectiveScopes = await this.buildEffectiveScopes(input.scopes, input.parentId);
    if (!isScopeSubset(effectiveScopes, actorScopes)) {
      throw new AppError(
        403,
        'SCOPE_NOT_ALLOWED',
        `Cannot grant scopes you do not possess: ${disallowedScopes(effectiveScopes, actorScopes).join(', ')}`
      );
    }
  }

  async assertCanUpdateGroup(id: string, input: UpdateGroupInput, actorScopes: string[]): Promise<void> {
    if (input.scopes === undefined && input.parentId === undefined) return;

    const existingGroup = await this.getGroup(id);
    const nextScopes = input.scopes ?? existingGroup.scopes;
    const nextParentId = input.parentId !== undefined ? input.parentId : existingGroup.parentId;
    const effectiveScopes = await this.buildEffectiveScopes(nextScopes, nextParentId);

    if (!isScopeSubset(effectiveScopes, actorScopes)) {
      throw new AppError(
        403,
        'SCOPE_NOT_ALLOWED',
        `Cannot grant scopes you do not possess: ${disallowedScopes(effectiveScopes, actorScopes).join(', ')}`
      );
    }
  }

  async listGroups() {
    const groups = await this.db
      .select({
        id: permissionGroups.id,
        name: permissionGroups.name,
        description: permissionGroups.description,
        isBuiltin: permissionGroups.isBuiltin,
        parentId: permissionGroups.parentId,
        scopes: permissionGroups.scopes,
        createdAt: permissionGroups.createdAt,
        updatedAt: permissionGroups.updatedAt,
        memberCount: sql<number>`(SELECT count(*) FROM users WHERE users.group_id = "permission_groups"."id")::int`,
      })
      .from(permissionGroups)
      .orderBy(sql`${permissionGroups.isBuiltin} DESC`, sql`jsonb_array_length(${permissionGroups.scopes}) DESC`);

    // Build a map for inherited scope computation
    const groupMap = new Map(groups.map((g) => [g.id, g]));

    return groups.map((g) => ({
      ...g,
      inheritedScopes: this.computeInheritedScopes(g.id, groupMap),
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

    // Fetch all groups for inherited scope computation
    const allGroups = await this.db.select().from(permissionGroups);
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));

    return {
      ...group,
      memberCount: Number(memberCount),
      inheritedScopes: this.computeInheritedScopes(group.id, groupMap),
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

    if (input.parentId) {
      const parent = await this.db.query.permissionGroups.findFirst({
        where: eq(permissionGroups.id, input.parentId),
      });
      if (!parent) {
        throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent group not found');
      }
      if (parent.parentId) {
        throw new AppError(
          400,
          'NESTING_TOO_DEEP',
          'Groups can only be nested one level deep — the parent group is already a child of another group'
        );
      }
    }

    const [group] = await this.db
      .insert(permissionGroups)
      .values({
        name: input.name,
        description: input.description ?? null,
        isBuiltin: false,
        parentId: input.parentId ?? null,
        scopes: input.scopes,
      })
      .returning();

    logger.info('Created permission group', { groupId: group.id, name: group.name, parentId: group.parentId });
    this.emitGroup(group.id, 'created');

    return {
      ...group,
      inheritedScopes: [] as string[],
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

    // Validate parentId doesn't create a cycle or exceed nesting depth
    if (input.parentId !== undefined) {
      if (input.parentId === id) {
        throw new AppError(400, 'CYCLE_DETECTED', 'A group cannot be its own parent');
      }
      if (input.parentId) {
        const allGroups = await this.db.select().from(permissionGroups);
        const groupMap = new Map(allGroups.map((g) => [g.id, g]));

        // Only allow nesting under top-level groups
        const parent = groupMap.get(input.parentId);
        if (parent?.parentId) {
          throw new AppError(
            400,
            'NESTING_TOO_DEEP',
            'Groups can only be nested one level deep — the parent group is already a child of another group'
          );
        }

        // A group with children cannot become a child itself
        const hasChildren = allGroups.some((g) => g.parentId === id);
        if (hasChildren) {
          throw new AppError(
            400,
            'NESTING_TOO_DEEP',
            'This group has child groups — it cannot be nested under another group'
          );
        }

        // Walk up from proposed parent to check for cycles
        let current: string | null = input.parentId;
        const visited = new Set<string>([id]);
        while (current) {
          if (visited.has(current)) {
            throw new AppError(400, 'CYCLE_DETECTED', 'This parent assignment would create a cycle');
          }
          visited.add(current);
          current = groupMap.get(current)?.parentId ?? null;
        }
      }
    }

    const [updated] = await this.db
      .update(permissionGroups)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.scopes !== undefined && { scopes: input.scopes }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        updatedAt: new Date(),
      })
      .where(eq(permissionGroups.id, id))
      .returning();

    logger.info('Updated permission group', { groupId: id, name: updated.name });
    this.emitGroup(id, 'updated');
    if (input.scopes !== undefined || input.parentId !== undefined) {
      await this.cascadePermissions(id);
    }

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

    // Unparent child groups before deleting
    const childGroupIds = (
      await this.db.select({ id: permissionGroups.id }).from(permissionGroups).where(eq(permissionGroups.parentId, id))
    ).map((group) => group.id);
    await this.db.update(permissionGroups).set({ parentId: null }).where(eq(permissionGroups.parentId, id));

    await this.db.delete(permissionGroups).where(eq(permissionGroups.id, id));
    logger.info('Deleted permission group', { groupId: id, name: group.name });
    this.emitGroup(id, 'deleted');

    for (const childGroupId of childGroupIds) {
      await this.cascadePermissions(childGroupId);
    }
  }

  async getMemberIds(groupId: string): Promise<string[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.groupId, groupId));
    return rows.map((r) => r.id);
  }

  /**
   * Compute inherited scopes by walking the parent chain.
   * Returns scopes from all ancestors (deduped), NOT including the group's own scopes.
   */
  private computeInheritedScopes(
    groupId: string,
    groupMap: Map<string, { id: string; parentId: string | null; scopes: unknown }>
  ): string[] {
    const inherited = new Set<string>();
    const group = groupMap.get(groupId);
    if (!group) return [];

    let current = group.parentId ? groupMap.get(group.parentId) : null;
    const visited = new Set<string>([groupId]);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const parentScopes = (current.scopes as string[]) ?? [];
      for (const s of parentScopes) inherited.add(s);
      current = current.parentId ? groupMap.get(current.parentId) : null;
    }

    return [...inherited];
  }
}
