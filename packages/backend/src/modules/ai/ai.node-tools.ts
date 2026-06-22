import type { NodesService } from '@/modules/nodes/nodes.service.js';
import type { User } from '@/types.js';
import { agentPage, agentPageLimit, allowedResourceIdsForScopes } from './ai.service-helpers.js';

export const NODE_TOOL_NAMES = new Set(['list_nodes', 'get_node', 'create_node', 'rename_node', 'delete_node']);

export interface NodeToolContext {
  nodesService: NodesService;
}

export async function executeNodeTool(
  context: NodeToolContext,
  user: User,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const a = args as any;

  switch (toolName) {
    case 'list_nodes': {
      const result = await context.nodesService.list(
        {
          search: a.search,
          type: a.type,
          status: a.status,
          page: agentPage(a.page),
          limit: agentPageLimit(a.limit),
        },
        { allowedIds: allowedResourceIdsForScopes(user.scopes, 'nodes:details') }
      );
      return {
        ...result,
        data: result.data.map((node) => ({
          id: node.id,
          type: node.type,
          hostname: node.hostname,
          displayName: node.displayName,
          appearanceColor: node.appearanceColor,
          status: node.status,
          isConnected: node.isConnected,
          serviceCreationLocked: node.serviceCreationLocked,
          daemonVersion: node.daemonVersion,
          osInfo: node.osInfo,
          configVersionHash: node.configVersionHash,
          capabilities: node.capabilities,
          lastSeenAt: node.lastSeenAt,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        })),
      };
    }
    case 'get_node':
      return context.nodesService.get(a.nodeId);
    case 'create_node':
      return context.nodesService.create(
        { hostname: a.hostname, type: a.type || 'nginx', displayName: a.displayName },
        user.id
      );
    case 'rename_node':
      return context.nodesService.update(a.nodeId, { displayName: a.displayName }, user.id);
    case 'delete_node':
      await context.nodesService.remove(a.nodeId, user.id);
      return { success: true };
    default:
      throw new Error(`Unsupported node tool: ${toolName}`);
  }
}
