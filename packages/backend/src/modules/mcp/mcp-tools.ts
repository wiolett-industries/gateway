import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { container } from '@/container.js';
import { hasScope } from '@/lib/permissions.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { AI_TOOLS } from '@/modules/ai/ai.tools.js';
import type { AIToolDefinition } from '@/modules/ai/ai.types.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import type { User } from '@/types.js';
import type { McpAuthContext } from './mcp-types.js';

const MCP_EXCLUDED_TOOLS = new Set(['ask_question', 'internal_documentation', 'web_search']);
const SENSITIVE_TOOL_ARG_RE =
  /(?:password|passwd|secret|signingsecret|privatekey|private_key|token|authorization|cookie|apikey|api_key|clientsecret|client_secret|refresh)/i;

function isEligibleMcpTool(tool: AIToolDefinition): boolean {
  return !!tool.requiredScope && !MCP_EXCLUDED_TOOLS.has(tool.name);
}

function hasToolScope(scopes: string[], tool: AIToolDefinition): boolean {
  return !!tool.requiredScope && hasScope(scopes, tool.requiredScope);
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
      args.certificateId ||
      args.proxyHostId ||
      args.domainId ||
      args.accessListId ||
      args.templateId ||
      args.userId ||
      args.nodeId ||
      args.containerId ||
      args.databaseId ||
      args.ruleId ||
      args.webhookId ||
      ''
  );
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
    if (!tool || !isEligibleMcpTool(tool) || !hasToolScope(auth.scopes, tool)) {
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
    });

    if (result.error) {
      return toolError(result.error);
    }

    return toolResult(result.result);
  });
}
