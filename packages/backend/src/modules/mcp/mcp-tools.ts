import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { container } from '@/container.js';
import { getResourceScopedIds, hasScope, hasScopeBase, hasScopeForResource } from '@/lib/permissions.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { AI_TOOLS } from '@/modules/ai/ai.tools.js';
import type { AIToolDefinition } from '@/modules/ai/ai.types.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import type { User } from '@/types.js';
import type { McpAuthContext } from './mcp-types.js';

const MCP_EXCLUDED_TOOLS = new Set(['ask_question', 'internal_documentation', 'web_search']);
const BROAD_ONLY_TOOL_SCOPES = new Set(['create_proxy_host']);
const DIRECT_DATABASE_VIEW_TOOLS = new Set(['list_databases', 'get_database_connection']);
const DIRECT_DATABASE_VIEW_AND_QUERY_TOOLS = new Set([
  'query_postgres_read',
  'execute_postgres_sql',
  'browse_redis_keys',
  'get_redis_key',
  'set_redis_key',
  'execute_redis_command',
]);
const ANY_SCOPE_TOOL_REQUIREMENTS: Record<string, string[]> = {
  list_cas: ['pki:ca:view:root', 'pki:ca:view:intermediate'],
  get_ca: ['pki:ca:view:root', 'pki:ca:view:intermediate'],
  delete_ca: ['pki:ca:revoke:root', 'pki:ca:revoke:intermediate'],
};
const SENSITIVE_TOOL_ARG_RE =
  /(?:password|passwd|secret|signingsecret|privatekey|private_key|token|authorization|cookie|apikey|api_key|clientsecret|client_secret|refresh)/i;

function isEligibleMcpTool(tool: AIToolDefinition): boolean {
  return !!tool.requiredScope && !MCP_EXCLUDED_TOOLS.has(tool.name);
}

function hasDirectScopeBase(scopes: string[], baseScope: string): boolean {
  return scopes.includes(baseScope) || scopes.some((scope) => scope.startsWith(`${baseScope}:`));
}

function getDirectResourceScopedIds(scopes: string[], baseScope: string): string[] {
  return scopes
    .filter((scope) => scope.startsWith(`${baseScope}:`) && scope.length > baseScope.length + 1)
    .map((scope) => scope.slice(baseScope.length + 1));
}

function hasDirectDatabaseViewForQueryTool(scopes: string[], queryScope: string): boolean {
  if (!hasScopeBase(scopes, queryScope) || !hasDirectScopeBase(scopes, 'databases:view')) return false;
  if (scopes.includes('databases:view') || hasScope(scopes, queryScope)) return true;

  const queryIds = new Set(getResourceScopedIds(scopes, queryScope));
  return getDirectResourceScopedIds(scopes, 'databases:view').some((databaseId) => queryIds.has(databaseId));
}

function hasDirectDatabaseViewForResource(scopes: string[], databaseId: string): boolean {
  return scopes.includes('databases:view') || scopes.includes(`databases:view:${databaseId}`);
}

function hasToolScope(scopes: string[], tool: AIToolDefinition): boolean {
  if (!tool.requiredScope) return false;
  const anyRequirements = ANY_SCOPE_TOOL_REQUIREMENTS[tool.name];
  if (anyRequirements) return anyRequirements.some((scope) => hasScope(scopes, scope));
  if (DIRECT_DATABASE_VIEW_TOOLS.has(tool.name)) {
    return hasDirectScopeBase(scopes, tool.requiredScope);
  }
  if (DIRECT_DATABASE_VIEW_AND_QUERY_TOOLS.has(tool.name)) {
    return hasDirectDatabaseViewForQueryTool(scopes, tool.requiredScope);
  }
  return BROAD_ONLY_TOOL_SCOPES.has(tool.name)
    ? hasScope(scopes, tool.requiredScope)
    : hasScopeBase(scopes, tool.requiredScope);
}

function hasToolScopeForArgs(scopes: string[], tool: AIToolDefinition, args: Record<string, unknown>): boolean {
  if (!tool.requiredScope) return false;
  const anyRequirements = ANY_SCOPE_TOOL_REQUIREMENTS[tool.name];
  if (anyRequirements) return anyRequirements.some((scope) => hasScope(scopes, scope));
  if (DIRECT_DATABASE_VIEW_TOOLS.has(tool.name)) {
    const resourceId = getToolAuthorizationResourceId(tool.name, args);
    if (scopes.includes(tool.requiredScope)) return true;
    return resourceId
      ? scopes.includes(`${tool.requiredScope}:${resourceId}`)
      : scopes.some((scope) => scope.startsWith(`${tool.requiredScope}:`));
  }
  if (DIRECT_DATABASE_VIEW_AND_QUERY_TOOLS.has(tool.name)) {
    const resourceId = getToolAuthorizationResourceId(tool.name, args);
    return resourceId
      ? hasDirectDatabaseViewForResource(scopes, resourceId) &&
          hasScopeForResource(scopes, tool.requiredScope, resourceId)
      : hasDirectDatabaseViewForQueryTool(scopes, tool.requiredScope);
  }
  if (BROAD_ONLY_TOOL_SCOPES.has(tool.name)) return hasScope(scopes, tool.requiredScope);
  const resourceId = getToolAuthorizationResourceId(tool.name, args);
  return resourceId
    ? hasScopeForResource(scopes, tool.requiredScope, resourceId)
    : hasScopeBase(scopes, tool.requiredScope);
}

function isMutatingTool(tool: AIToolDefinition): boolean {
  return tool.destructive || tool.invalidateStores.length > 0;
}

function redactToolArgs(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[REDACTED_DEPTH_LIMIT]';

  if (Array.isArray(value)) {
    return value.map((item) => redactToolArgs(item, depth + 1));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_TOOL_ARG_RE.test(key) ? '[REDACTED]' : redactToolArgs(nested, depth + 1);
  }
  return redacted;
}

function getToolResourceId(args: Record<string, unknown>): string {
  return String(
    args.caId ||
      args.parentCaId ||
      args.certificateId ||
      args.proxyHostId ||
      args.domainId ||
      args.accessListId ||
      args.templateId ||
      args.userId ||
      args.nodeId ||
      args.containerId ||
      args.deploymentId ||
      args.databaseId ||
      args.ruleId ||
      args.webhookId ||
      ''
  );
}

function getToolAuthorizationResourceId(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'create_proxy_host') return '';
  return getToolResourceId(args);
}

async function auditDeniedMutatingTool(
  tool: AIToolDefinition,
  auth: McpAuthContext,
  user: User,
  args: Record<string, unknown>,
  reason: string
): Promise<void> {
  if (!isMutatingTool(tool)) return;

  await container.resolve(AuditService).log({
    userId: user.id,
    action: `mcp.${tool.name}`,
    resourceType: tool.category.toLowerCase().replace(/\s+/g, '_'),
    resourceId: getToolResourceId(args),
    details: {
      source: 'mcp',
      success: false,
      denied: true,
      reason,
      tokenId: auth.tokenId,
      tokenPrefix: auth.tokenPrefix,
      authType: auth.authType,
      clientId: auth.clientId,
      toolName: tool.name,
      category: tool.category,
      requiredScope: tool.requiredScope,
      arguments: redactToolArgs(args),
    },
  });
}

export function listAvailableMcpTools(scopes: string[]): AIToolDefinition[] {
  return AI_TOOLS.filter((tool) => isEligibleMcpTool(tool) && hasToolScope(scopes, tool));
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function toolResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      },
    ],
  };
}

export function registerMcpToolHandlers(server: McpAuthContext['server'], auth: McpAuthContext, user: User): void {
  server.server.registerCapabilities({ tools: { listChanged: false } });

  server.server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => {
    const tools = listAvailableMcpTools(auth.scopes).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
      annotations: {
        readOnlyHint: !tool.destructive && tool.invalidateStores.length === 0,
        destructiveHint: tool.destructive,
      },
      _meta: {
        category: tool.category,
        requiredScope: tool.requiredScope,
      },
    }));

    return { tools };
  });

  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const toolName = request.params.name;
    const tool = AI_TOOLS.find((candidate) => candidate.name === toolName);
    const args = request.params.arguments ?? {};
    if (!tool || !isEligibleMcpTool(tool) || !hasToolScopeForArgs(auth.scopes, tool, args)) {
      if (tool && isEligibleMcpTool(tool)) {
        await auditDeniedMutatingTool(tool, auth, user, args, 'missing_scope');
      }
      return toolError(`Tool "${toolName}" is unavailable for this MCP token`);
    }

    const result = await container.resolve(AIService).executeTool(user, toolName, args, {
      source: 'mcp',
      scopes: auth.scopes,
      tokenId: auth.tokenId,
      tokenPrefix: auth.tokenPrefix,
      authType: auth.authType,
      clientId: auth.clientId,
    });

    if (result.error) {
      return toolError(result.error);
    }

    return toolResult(result.result);
  });
}
