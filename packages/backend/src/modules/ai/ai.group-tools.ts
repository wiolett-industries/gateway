import type { GroupService } from '@/modules/groups/group.service.js';
import type { User } from '@/types.js';

export const GROUP_TOOL_NAMES = new Set(['list_groups', 'create_group', 'update_group', 'delete_group']);

export interface GroupToolContext {
  groupService: GroupService;
}

export async function executeGroupTool(
  context: GroupToolContext,
  user: User,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const a = args as any;

  switch (toolName) {
    case 'list_groups':
      return context.groupService.listGroups();
    case 'create_group': {
      const input = {
        name: a.name,
        description: a.description,
        scopes: a.scopes,
        parentId: a.parentId,
      };
      await context.groupService.assertCanCreateGroup(input, user.scopes);
      return context.groupService.createGroup(input);
    }
    case 'update_group': {
      const input = {
        name: a.name,
        description: a.description,
        scopes: a.scopes,
        parentId: a.parentId,
      };
      await context.groupService.assertCanUpdateGroup(a.groupId, input, user.scopes);
      return context.groupService.updateGroup(a.groupId, input);
    }
    case 'delete_group':
      await context.groupService.assertCanDeleteGroup(a.groupId, user.scopes);
      await context.groupService.deleteGroup(a.groupId);
      return { success: true };
    default:
      throw new Error(`Unsupported group tool: ${toolName}`);
  }
}
