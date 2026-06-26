import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { container, TOKENS } from '@/container.js';
import { nodes as nodesTable } from '@/db/schema/nodes.js';
import { createChildLogger } from '@/lib/logger.js';
import { canManageUser, hasScope, hasScopeBase, hasScopeForResource, isScopeSubset } from '@/lib/permissions.js';
import { canonicalizeScopes } from '@/lib/scopes.js';
import type { AccessListService } from '@/modules/access-lists/access-list.service.js';
import { UpdateAuthProvisioningSettingsSchema } from '@/modules/admin/admin.schemas.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { AuthService } from '@/modules/auth/auth.service.js';
import { AuthSettingsService } from '@/modules/auth/auth.settings.service.js';
import type { DatabaseConnectionService } from '@/modules/databases/databases.service.js';
import type { DockerManagementService } from '@/modules/docker/docker.service.js';
import type { DomainsService } from '@/modules/domains/domain.service.js';
import type { GroupService } from '@/modules/groups/group.service.js';
import { LicenseService } from '@/modules/license/license.service.js';
import { McpSettingsService } from '@/modules/mcp/mcp-settings.service.js';
import type { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import type { NodesService } from '@/modules/nodes/nodes.service.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import type { CertService } from '@/modules/pki/cert.service.js';
import type { TemplatesService } from '@/modules/pki/templates.service.js';
import type { FolderService } from '@/modules/proxy/folder.service.js';
import { CreateNginxTemplateSchema, UpdateNginxTemplateSchema } from '@/modules/proxy/nginx-template.schemas.js';
import type { ProxyService } from '@/modules/proxy/proxy.service.js';
import { GeneralSettingsService } from '@/modules/settings/general-settings.service.js';
import { NetworkSettingsService } from '@/modules/settings/network-settings.service.js';
import { OutboundWebhookPolicyService } from '@/modules/settings/outbound-webhook-policy.service.js';
import { UploadCertSchema } from '@/modules/ssl/ssl.schemas.js';
import type { SSLService } from '@/modules/ssl/ssl.service.js';
import { CreateTokenSchema, UpdateTokenSchema } from '@/modules/tokens/tokens.schemas.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { DaemonUpdateService } from '@/services/daemon-update.service.js';
import { EventBusService } from '@/services/event-bus.service.js';
import { HousekeepingService } from '@/services/housekeeping.service.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import { SessionService } from '@/services/session.service.js';
import { UpdateService } from '@/services/update.service.js';
import type { User } from '@/types.js';
import { ACCESS_LIST_TOOL_NAMES, executeAccessListTool } from './ai.access-list-tools.js';
import { DATABASE_TOOL_NAMES, executeDatabaseTool } from './ai.database-tools.js';
import { manageDockerContainerConfigTool } from './ai.docker-config-tools.js';
import { DOCKER_TOOL_NAMES, executeDockerTool } from './ai.docker-tools.js';
import { getInternalDocumentation } from './ai.docs.js';
import { DOMAIN_TOOL_NAMES, executeDomainTool } from './ai.domain-tools.js';
import { executeFolderTool, FOLDER_TOOL_NAMES } from './ai.folder-tools.js';
import { executeGroupTool, GROUP_TOOL_NAMES } from './ai.group-tools.js';
import { manageLoggingTool } from './ai.logging-tools.js';
import { executeNodeTool, NODE_TOOL_NAMES } from './ai.node-tools.js';
import { executeNotificationTool, NOTIFICATION_TOOL_NAMES } from './ai.notification-tools.js';
import { executePkiCaTool, PKI_CA_TOOL_NAMES } from './ai.pki-ca-tools.js';
import { executePkiCertificateTool, PKI_CERTIFICATE_TOOL_NAMES } from './ai.pki-certificate-tools.js';
import { executePkiTemplateTool, PKI_TEMPLATE_TOOL_NAMES } from './ai.pki-template-tools.js';
import { streamModelResponse } from './ai.provider-adapter.js';
import { executeProxyTool, PROXY_TOOL_NAMES } from './ai.proxy-tools.js';
import { findResource } from './ai.resource-search.js';
import type { AISandboxService } from './ai.sandbox.service.js';
import type { AISandboxArtifactService } from './ai.sandbox-artifact.service.js';
import {
  agentPage,
  agentPageLimit,
  allowedResourceIdsForScopes,
  compactProxyHostForAgent,
  dashboardStatsOptionsForScopes,
  estimateTokens,
  getToolResourceId,
  hasToolExecutionScope,
  isMutatingTool,
  redactToolArgs,
  trimToTokenBudget,
} from './ai.service-helpers.js';
import type { AISettingsService } from './ai.settings.service.js';
import { manageStatusPageTool } from './ai.status-page-tools.js';
import { buildAISystemPrompt } from './ai.system-prompt.js';
import { AI_TOOLS, getOpenAITools, TOOL_STORE_INVALIDATION_MAP } from './ai.tools.js';
import type {
  AIMessageAttachment,
  ChatMessage,
  PageContext,
  ToolExecutionOptions,
  ToolExecutionResult,
  WSServerMessage,
} from './ai.types.js';
import { executeWebSearch } from './ai.web-search.js';
import { getAIToolApprovalDecision } from './ai-approval-policy.js';
import { AIConversationService } from './ai-conversation.service.js';

const logger = createChildLogger('AIService');
const SANDBOX_TOOL_NAMES = new Set([
  'execute_script',
  'run_process',
  'fetch',
  'download_artifact',
  'read_artifact',
  'send_artifact',
  'read_process_output',
  'write_process_stdin',
  'kill_process',
  'list_sandbox_jobs',
]);

type QueuedApproval = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ToolRuntimeContext = {
  pageContext?: PageContext;
  conversationId?: string;
};

function isContextWindowError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error);
  return /context(?:_| )?(?:length|window)|maximum context|max(?:imum)? tokens|too many tokens/i.test(message);
}

function conversationEndReason(result: unknown, fallback: string): string {
  if (isRecord(result) && typeof result.reason === 'string' && result.reason.trim()) {
    return result.reason.trim();
  }
  return fallback;
}

function compactToolResultForModel(toolName: string, value: unknown): unknown {
  if (value == null) return value;
  if (toolName === 'get_docker_container_logs') return compactLogLikeResult(value, 'Docker container logs');
  if (toolName === 'send_artifact' && isRecord(value)) {
    const { artifactId, filename, mediaType, sizeBytes, sourcePath, downloadUrl } = value;
    return { artifactId, filename, mediaType, sizeBytes, sourcePath, downloadUrl };
  }
  if ((toolName === 'fetch' || toolName === 'read_artifact') && isRecord(value)) {
    const content = typeof value.content === 'string' ? value.content : undefined;
    if (content && content.length > 4000) {
      return {
        ...value,
        content: undefined,
        contentPreview: content.slice(0, 2000),
        contentOmitted: true,
      };
    }
  }
  if (toolName === 'manage_logging' && isRecord(value) && Array.isArray(value.rows)) {
    return compactLogLikeResult(value.rows, 'Structured log search results');
  }
  if (typeof value === 'string' && value.length > 4000) {
    return compactLogText(value, 'Large text tool output');
  }
  if (Array.isArray(value) && value.length > 25) {
    return {
      summary: `Large array tool output omitted from model context (${value.length} items).`,
      count: value.length,
      sample: [...value.slice(0, 5), ...value.slice(-5)],
      fullOutputOmitted: true,
    };
  }
  return value;
}

function compactLogLikeResult(value: unknown, label: string): unknown {
  if (typeof value === 'string') return compactLogText(value, label);
  if (!Array.isArray(value)) return value;
  return {
    summary: `${label} omitted from model context (${value.length} entries).`,
    count: value.length,
    sample: [...value.slice(0, 3), ...value.slice(-5)],
    fullOutputOmitted: true,
  };
}

function compactLogText(value: string, label: string): unknown {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return {
    summary: `${label} omitted from model context (${lines.length} lines, ${value.length} chars).`,
    lineCount: lines.length,
    sample: [...lines.slice(0, 3), ...lines.slice(-5)],
    fullOutputOmitted: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolArg(value: unknown): boolean {
  return value === true;
}

function getEffectiveGroupScopes(group: { scopes?: string[]; inheritedScopes?: string[] }): string[] {
  return [...new Set([...(group.scopes ?? []), ...(group.inheritedScopes ?? [])])];
}

const AI_SETTINGS_UPDATE_FIELDS = new Set([
  'enabled',
  'providerUrl',
  'endpointMode',
  'supportsImages',
  'apiKey',
  'model',
  'customSystemPrompt',
  'rateLimitMax',
  'rateLimitWindowSeconds',
  'maxToolRounds',
  'maxContextTokens',
  'maxCompletionTokens',
  'maxTokensField',
  'reasoningEffort',
  'disabledTools',
  'webSearchProvider',
  'webSearchBaseUrl',
  'webSearchApiKey',
  'sandboxEnabled',
  'sandboxDefaultTier',
]);

function aiSettingsUpdatesFromArgs(args: Record<string, unknown>): Record<string, unknown> {
  const updatesSource = isRecord(args.updates) ? args.updates : args;
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updatesSource)) {
    if (AI_SETTINGS_UPDATE_FIELDS.has(key)) updates[key] = value;
  }
  return updates;
}

function mergeToolsets(existing: string[], added: string[]): string[] {
  return [...new Set([...existing, ...added].map((toolset) => toolset.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function discoveredToolsetsFromResult(value: unknown): string[] {
  return isRecord(value) && Array.isArray(value.discoveredToolsets)
    ? value.discoveredToolsets.filter((toolset): toolset is string => typeof toolset === 'string')
    : [];
}

export class AIService {
  constructor(
    private readonly settingsService: AISettingsService,
    private readonly caService: CAService,
    private readonly certService: CertService,
    private readonly templatesService: TemplatesService,
    private readonly proxyService: ProxyService,
    private readonly folderService: FolderService,
    private readonly sslService: SSLService,
    private readonly domainsService: DomainsService,
    private readonly accessListService: AccessListService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly monitoringService: MonitoringService,
    private readonly nodesService: NodesService,
    private readonly groupService: GroupService,
    private readonly databaseService: DatabaseConnectionService,
    private readonly dockerService: DockerManagementService,
    private readonly notifRuleService?: import('@/modules/notifications/notification-alert-rule.service.js').NotificationAlertRuleService,
    private readonly notifWebhookService?: import('@/modules/notifications/notification-webhook.service.js').NotificationWebhookService,
    private readonly notifDeliveryService?: import('@/modules/notifications/notification-delivery.service.js').NotificationDeliveryService,
    private readonly notifDispatcherService?: import('@/modules/notifications/notification-dispatcher.service.js').NotificationDispatcherService,
    private readonly sandboxService?: AISandboxService,
    private readonly artifactService?: AISandboxArtifactService
  ) {}

  async buildSystemPrompt(user: User, pageContext?: PageContext): Promise<string> {
    return buildAISystemPrompt(
      {
        settingsService: this.settingsService,
        monitoringService: this.monitoringService,
        caService: this.caService,
      },
      user,
      pageContext
    );
  }

  async executeTool(
    user: User,
    toolName: string,
    args: Record<string, unknown>,
    options: ToolExecutionOptions = {}
  ): Promise<ToolExecutionResult> {
    const toolDef = AI_TOOLS.find((t) => t.name === toolName);
    if (!toolDef) {
      return { error: `Unknown tool: ${toolName}`, invalidateStores: [] };
    }

    const executionUser = options.scopes ? { ...user, scopes: options.scopes } : user;

    // Permission check — tools with empty requiredScope are blocked (must be explicit)
    if (!hasToolExecutionScope(executionUser.scopes, toolName, toolDef.requiredScope, args)) {
      return {
        error: `PERMISSION_DENIED: You do not have the "${toolDef.requiredScope || 'unknown'}" scope required for this action. Tell the user they lack this permission and suggest contacting an administrator. Do NOT ask follow-up questions or retry.`,
        invalidateStores: [],
      };
    }

    const source = options.source ?? 'ai';
    const shouldAudit = isMutatingTool(toolDef);
    const redactedArgs = redactToolArgs(args);
    const auditBase = {
      userId: user.id,
      resourceType: toolDef.category.toLowerCase().replace(/\s+/g, '_'),
      resourceId: getToolResourceId(args),
    };

    try {
      const result = await this.executeToolInternal(executionUser, toolName, args, {
        pageContext: options.pageContext,
        conversationId: options.conversationId,
      });
      const invalidateStores = TOOL_STORE_INVALIDATION_MAP[toolName] || [];
      await this.persistToolRuntimeState(user, options, toolName, result);

      // Audit log for mutating tools
      if (shouldAudit) {
        await this.auditService.log({
          ...auditBase,
          action: `${source}.${toolName}`,
          details:
            source === 'mcp'
              ? {
                  source: 'mcp',
                  success: true,
                  tokenId: options.tokenId,
                  tokenPrefix: options.tokenPrefix,
                  authType: options.authType,
                  clientId: options.clientId,
                  toolName,
                  category: toolDef.category,
                  arguments: redactedArgs,
                }
              : { ai_initiated: true, arguments: redactedArgs },
        });
      }

      return { result, invalidateStores };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      logger.error(`Tool execution failed: ${toolName}`, { error: err, args: redactToolArgs(args) });
      if (source === 'mcp' && shouldAudit) {
        await this.auditService.log({
          ...auditBase,
          action: `mcp.${toolName}`,
          details: {
            source: 'mcp',
            success: false,
            error: message,
            tokenId: options.tokenId,
            tokenPrefix: options.tokenPrefix,
            authType: options.authType,
            clientId: options.clientId,
            toolName,
            category: toolDef.category,
            arguments: redactedArgs,
          },
        });
      }
      return { error: message, invalidateStores: [] };
    }
  }

  private async executeSandboxTool(
    user: User,
    toolName: string,
    args: Record<string, unknown>,
    runtimeContext: ToolRuntimeContext
  ) {
    const config = await this.settingsService.getConfig();
    if (!config.sandboxEnabled) {
      throw new Error('Sandbox runner is disabled');
    }
    if (!this.sandboxService) {
      throw new Error('Sandbox runner is not configured');
    }
    const a = args as Record<string, unknown>;
    const resourceTier = (a.resourceTier ?? config.sandboxDefaultTier) as never;
    switch (toolName) {
      case 'execute_script':
        return this.sandboxService.executeScript(user, {
          runtime: a.runtime,
          script: String(a.script ?? ''),
          resourceTier,
          ttlSeconds: typeof a.ttlSeconds === 'number' ? a.ttlSeconds : undefined,
          conversationId: runtimeContext.conversationId,
        });
      case 'run_process':
        return this.sandboxService.runProcess(user, {
          runtime: a.runtime,
          command: Array.isArray(a.command) ? a.command.map(String) : [],
          resourceTier,
          ttlSeconds: typeof a.ttlSeconds === 'number' ? a.ttlSeconds : undefined,
          conversationId: runtimeContext.conversationId,
        });
      case 'fetch':
        return this.sandboxService.fetch(user, { url: String(a.url ?? '') });
      case 'download_artifact':
        return this.sandboxService.downloadArtifact(user, {
          processId: String(a.processId ?? ''),
          url: String(a.url ?? ''),
          path: typeof a.path === 'string' ? a.path : undefined,
        });
      case 'read_artifact':
        return this.sandboxService.readArtifact(user, {
          processId: String(a.processId ?? ''),
          path: String(a.path ?? ''),
          offset: typeof a.offset === 'number' ? a.offset : undefined,
          length: typeof a.length === 'number' ? a.length : undefined,
          encoding: a.encoding === 'base64' ? 'base64' : 'utf8',
        });
      case 'send_artifact':
        return this.sandboxService.sendArtifact(user, {
          processId: String(a.processId ?? ''),
          path: String(a.path ?? ''),
          filename: typeof a.filename === 'string' ? a.filename : undefined,
          mediaType: typeof a.mediaType === 'string' ? a.mediaType : undefined,
          conversationId: runtimeContext.conversationId,
        });
      case 'read_process_output':
        return this.sandboxService.readProcessOutput(
          user,
          String(a.processId ?? ''),
          typeof a.tail === 'number' ? a.tail : undefined
        );
      case 'write_process_stdin':
        return this.sandboxService.writeProcessStdin(
          user,
          String(a.processId ?? ''),
          String(a.data ?? ''),
          a.close === true
        );
      case 'kill_process':
        return this.sandboxService.killProcess(user, String(a.processId ?? ''));
      case 'list_sandbox_jobs':
        return this.sandboxService.listJobs(user, {
          activeOnly: a.activeOnly === true,
          limit: typeof a.limit === 'number' ? a.limit : undefined,
        });
      default:
        throw new Error(`Unsupported sandbox tool: ${toolName}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeToolInternal(
    user: User,
    toolName: string,
    args: Record<string, unknown>,
    runtimeContext: ToolRuntimeContext = {}
  ): Promise<unknown> {
    // Tool args come from LLM JSON — use explicit casts to match service input types.
    // The services themselves validate the data, so loose typing here is acceptable.
    const a = args as any; // shorthand for repeated casts

    if (DATABASE_TOOL_NAMES.has(toolName)) {
      return executeDatabaseTool({ databaseService: this.databaseService }, user, toolName, args);
    }
    if (DOCKER_TOOL_NAMES.has(toolName)) {
      return executeDockerTool(
        {
          dockerService: this.dockerService,
          ensureToolScope: (executionUser, scope) => this.ensureToolScope(executionUser, scope),
          ensureToolScopeForResource: (executionUser, baseScope, resourceId) =>
            this.ensureToolScopeForResource(executionUser, baseScope, resourceId),
        },
        user,
        toolName,
        args
      );
    }
    if (NOTIFICATION_TOOL_NAMES.has(toolName)) {
      return executeNotificationTool(
        {
          notifRuleService: this.notifRuleService,
          notifWebhookService: this.notifWebhookService,
          notifDeliveryService: this.notifDeliveryService,
          notifDispatcherService: this.notifDispatcherService,
        },
        user,
        toolName,
        args
      );
    }
    if (SANDBOX_TOOL_NAMES.has(toolName)) {
      return this.executeSandboxTool(user, toolName, args, runtimeContext);
    }
    if (FOLDER_TOOL_NAMES.has(toolName)) {
      return executeFolderTool(user, toolName, args);
    }
    if (NODE_TOOL_NAMES.has(toolName)) {
      return executeNodeTool(
        { nodesService: this.nodesService, getDispatchService: () => container.resolve(NodeDispatchService) },
        user,
        toolName,
        args
      );
    }
    if (GROUP_TOOL_NAMES.has(toolName)) {
      return executeGroupTool({ groupService: this.groupService }, user, toolName, args);
    }
    if (DOMAIN_TOOL_NAMES.has(toolName)) {
      return executeDomainTool(
        {
          domainsService: this.domainsService,
          ensureToolScopeForResource: (executionUser, baseScope, resourceId) =>
            this.ensureToolScopeForResource(executionUser, baseScope, resourceId),
        },
        user,
        toolName,
        args
      );
    }
    if (ACCESS_LIST_TOOL_NAMES.has(toolName)) {
      return executeAccessListTool(
        {
          accessListService: this.accessListService,
          ensureToolScopeForResource: (executionUser, baseScope, resourceId) =>
            this.ensureToolScopeForResource(executionUser, baseScope, resourceId),
        },
        user,
        toolName,
        args
      );
    }
    if (PKI_TEMPLATE_TOOL_NAMES.has(toolName)) {
      return executePkiTemplateTool(
        {
          templatesService: this.templatesService,
          ensureToolScope: (executionUser, scope) => this.ensureToolScope(executionUser, scope),
          ensureToolScopeForResource: (executionUser, baseScope, resourceId) =>
            this.ensureToolScopeForResource(executionUser, baseScope, resourceId),
        },
        user,
        toolName,
        args
      );
    }
    if (PKI_CA_TOOL_NAMES.has(toolName)) {
      return executePkiCaTool({ caService: this.caService }, user, toolName, args);
    }
    if (PKI_CERTIFICATE_TOOL_NAMES.has(toolName)) {
      return executePkiCertificateTool(
        {
          caService: this.caService,
          certService: this.certService,
          ensureToolScope: (executionUser, scope) => this.ensureToolScope(executionUser, scope),
          ensureToolScopeForResource: (executionUser, baseScope, resourceId) =>
            this.ensureToolScopeForResource(executionUser, baseScope, resourceId),
        },
        user,
        toolName,
        args
      );
    }
    if (PROXY_TOOL_NAMES.has(toolName)) {
      return executeProxyTool(
        { proxyService: this.proxyService, folderService: this.folderService },
        user,
        toolName,
        args
      );
    }

    switch (toolName) {
      // ── Discovery ──
      case 'discover_tools':
        return this.discoverTools(user, args);

      case 'get_current_context':
        return {
          currentPage: runtimeContext.pageContext ?? null,
          hasCurrentPage: !!runtimeContext.pageContext?.route,
        };

      case 'wait': {
        const rawSeconds = Number(a.seconds ?? 5);
        const seconds = Math.min(30, Math.max(1, Number.isFinite(rawSeconds) ? rawSeconds : 5));
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return {
          waitedSeconds: seconds,
          reason: stringArg(a.reason) ?? null,
          nextStep: 'Call the relevant read/status tool again to verify whether the pending operation completed.',
        };
      }

      case 'end_conversation': {
        const reason = String(a.reason ?? '').trim();
        return {
          ended: true,
          reason: reason || 'This conversation has been ended.',
        };
      }

      case 'find_resource':
        return findResource(
          {
            executeToolInternal: (executionUser, delegatedToolName, delegatedArgs) =>
              this.executeToolInternal(executionUser, delegatedToolName, delegatedArgs, runtimeContext),
            nodesService: this.nodesService,
          },
          user,
          args
        );

      case 'manage_proxy_template': {
        const { NginxTemplateService } = await import('@/modules/proxy/nginx-template.service.js');
        const templateService = container.resolve(NginxTemplateService);
        if (a.operation === 'list') {
          this.ensureToolScope(user, 'proxy:templates:view');
          return templateService.listTemplates({
            allowedIds: allowedResourceIdsForScopes(user.scopes, 'proxy:templates:view'),
          });
        }
        if (a.operation === 'get') {
          this.ensureToolScopeForResource(user, 'proxy:templates:view', String(a.templateId));
          return templateService.getTemplate(a.templateId);
        }
        if (a.operation === 'create') {
          this.ensureToolScope(user, 'proxy:templates:create');
          return templateService.createTemplate(CreateNginxTemplateSchema.parse(args), user.id);
        }
        if (a.operation === 'update') {
          this.ensureToolScopeForResource(user, 'proxy:templates:edit', String(a.templateId));
          return templateService.updateTemplate(a.templateId, UpdateNginxTemplateSchema.parse(args), user.id);
        }
        if (a.operation === 'delete') {
          this.ensureToolScopeForResource(user, 'proxy:templates:delete', String(a.templateId));
          await templateService.deleteTemplate(a.templateId, user.id);
          return { success: true };
        }
        if (a.operation === 'clone') {
          this.ensureToolScopeForResource(user, 'proxy:templates:edit', String(a.templateId));
          this.ensureToolScope(user, 'proxy:templates:create');
          return templateService.cloneTemplate(a.templateId, user.id);
        }
        throw new Error(`Unsupported proxy template operation: ${String(a.operation)}`);
      }

      // ── SSL Certificates ──
      case 'list_ssl_certificates':
        return this.sslService.listCerts(
          { search: a.search, page: agentPage(a.page), limit: agentPageLimit(a.limit) },
          { allowedIds: allowedResourceIdsForScopes(user.scopes, 'ssl:cert:view') }
        );
      case 'link_internal_cert':
        return this.sslService.linkInternalCert({ internalCertId: a.internalCertId, name: a.name }, user.id);
      case 'request_acme_cert':
        return this.sslService.requestACMECert(
          {
            domains: a.domains,
            challengeType: a.challengeType,
            provider: a.provider || 'letsencrypt',
            autoRenew: a.autoRenew !== false,
          },
          user.id
        );
      case 'manage_ssl_certificate': {
        if (a.operation === 'get') {
          this.ensureToolScopeForResource(user, 'ssl:cert:view', String(a.sslCertificateId));
          return this.sslService.getCert(a.sslCertificateId);
        }
        if (a.operation === 'upload') {
          this.ensureToolScope(user, 'ssl:cert:issue');
          return this.sslService.uploadCert(UploadCertSchema.parse(args), user.id);
        }
        if (a.operation === 'renew') {
          this.ensureToolScopeForResource(user, 'ssl:cert:issue', String(a.sslCertificateId));
          return this.sslService.renewCert(a.sslCertificateId, user.id);
        }
        if (a.operation === 'verify_dns') {
          this.ensureToolScopeForResource(user, 'ssl:cert:issue', String(a.sslCertificateId));
          return this.sslService.completeDNS01Verification(a.sslCertificateId, user.id);
        }
        if (a.operation === 'delete') {
          this.ensureToolScopeForResource(user, 'ssl:cert:delete', String(a.sslCertificateId));
          await this.sslService.deleteCert(a.sslCertificateId, user.id);
          return { success: true };
        }
        throw new Error(`Unsupported SSL certificate operation: ${String(a.operation)}`);
      }

      // ── Raw Config ──
      case 'get_proxy_rendered_config': {
        const host = await this.proxyService.getProxyHost(a.proxyHostId);
        if (!host) throw new Error('Proxy host not found');
        const renderedConfig = await this.proxyService.getRenderedConfig(a.proxyHostId);
        return { proxyHostId: a.proxyHostId, config: renderedConfig };
      }
      case 'update_proxy_raw_config': {
        const rawHost = await this.proxyService.getProxyHost(a.proxyHostId);
        if (!rawHost) throw new Error('Proxy host not found');
        if (!(rawHost as any).rawConfigEnabled) {
          throw new Error('Raw mode is not enabled on this proxy host. Enable it first with toggle_proxy_raw_mode.');
        }
        const bypassRawValidation = hasScope(user.scopes, `proxy:raw:bypass:${a.proxyHostId}`);
        return compactProxyHostForAgent(
          await this.proxyService.updateProxyHost(a.proxyHostId, { rawConfig: a.rawConfig } as any, user.id, {
            bypassRawValidation,
          })
        );
      }
      case 'toggle_proxy_raw_mode':
        return compactProxyHostForAgent(
          await this.proxyService.updateProxyHost(a.proxyHostId, { rawConfigEnabled: a.enabled } as any, user.id)
        );

      // ── Administration ──
      case 'list_users':
        return this.authService.listUsers();
      case 'create_user': {
        const destGroup = await this.groupService.getGroup(a.groupId);
        if (!isScopeSubset(getEffectiveGroupScopes(destGroup), user.scopes)) {
          throw new Error('Cannot assign a group with permissions you do not possess');
        }
        return this.authService.createUser({
          email: a.email,
          name: a.name,
          groupId: a.groupId,
        });
      }
      case 'update_user_role': {
        if (a.userId === user.id) {
          throw new Error('Cannot change your own group');
        }
        const targetUser = await this.authService.getUserById(a.userId);
        if (!targetUser) throw new Error('User not found');
        if (targetUser.oidcSubject.startsWith('system:')) {
          throw new Error('Cannot modify the system user');
        }
        await this.authService.assertCanUpdateUserGroup(user.id, user.scopes, a.userId, a.groupId);
        const updated = await this.authService.updateUserGroup(a.userId, a.groupId);
        await container.resolve(SessionService).destroyAllUserSessions(a.userId);
        return updated;
      }
      case 'set_user_blocked': {
        if (a.userId === user.id) {
          throw new Error('Cannot block yourself');
        }
        const targetUser = await this.authService.getUserById(a.userId);
        if (!targetUser) throw new Error('User not found');
        if (targetUser.oidcSubject.startsWith('system:')) {
          throw new Error('Cannot modify the system user');
        }
        const denyReason = canManageUser(user.scopes, targetUser.scopes);
        if (denyReason) throw new Error(denyReason);
        return a.blocked ? this.authService.blockUser(a.userId) : this.authService.unblockUser(a.userId);
      }
      case 'delete_user': {
        if (a.userId === user.id) {
          throw new Error('Cannot delete your own account');
        }
        const targetUser = await this.authService.getUserById(a.userId);
        if (!targetUser) throw new Error('User not found');
        if (targetUser.oidcSubject.startsWith('system:')) {
          throw new Error('Cannot delete the system user');
        }
        const denyReason = canManageUser(user.scopes, targetUser.scopes);
        if (denyReason) throw new Error(denyReason);
        await this.authService.deleteUser(a.userId);
        return { success: true };
      }
      case 'get_ai_settings':
        return this.settingsService.getConfigForAdmin();
      case 'update_ai_settings': {
        const updates = aiSettingsUpdatesFromArgs(args);
        if (Object.keys(updates).length === 0) {
          throw new Error('No supported AI settings fields were provided');
        }
        await this.settingsService.updateConfig(updates);
        return this.settingsService.getConfigForAdmin();
      }
      case 'list_ai_tools':
        return AI_TOOLS.map((tool) => ({
          name: tool.name,
          category: tool.category,
          description: tool.description,
          destructive: tool.destructive,
          requiredScope: tool.requiredScope,
          invalidateStores: tool.invalidateStores,
        }));
      case 'get_sandbox_runtime_status': {
        const config = await this.settingsService.getConfig();
        const status = this.sandboxService?.status() ?? { status: 'unconfigured' };
        const health = this.sandboxService
          ? await this.sandboxService.health().catch((error) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }))
          : { ok: false, error: 'Sandbox runner is not configured' };
        return {
          enabled: config.sandboxEnabled,
          defaultTier: config.sandboxDefaultTier,
          status,
          health,
        };
      }
      case 'manage_ai_conversation': {
        const conversationService = container.resolve(AIConversationService);
        const operation = String(a.operation ?? '');
        switch (operation) {
          case 'list':
            return conversationService.listConversations(user.id);
          case 'get': {
            const conversationId = String(a.conversationId ?? '');
            if (!conversationId) throw new Error('conversationId is required');
            const conversation = await conversationService.getConversation(user.id, conversationId);
            if (!conversation) throw new Error('Conversation not found');
            return conversation;
          }
          case 'delete': {
            const conversationId = String(a.conversationId ?? '');
            if (!conversationId) throw new Error('conversationId is required');
            const deleted = await conversationService.deleteConversation(user.id, conversationId);
            if (!deleted) throw new Error('Conversation not found');
            return { deleted: true };
          }
          case 'delete_by_title': {
            const title = String(a.title ?? '');
            if (!title.trim()) throw new Error('title is required');
            return { deleted: await conversationService.deleteConversationByTitle(user.id, title) };
          }
          default:
            throw new Error('Unsupported conversation operation');
        }
      }
      case 'manage_oauth_authorization': {
        const { OAuthService } = await import('@/modules/oauth/oauth.service.js');
        const oauthService = container.resolve(OAuthService);
        const operation = String(a.operation ?? '');
        switch (operation) {
          case 'list':
            return oauthService.listUserAuthorizations(user.id);
          case 'update_scopes': {
            const clientId = String(a.clientId ?? '');
            const resource = String(a.resource ?? '');
            const scopes = Array.isArray(a.scopes) ? a.scopes.map(String) : [];
            if (!clientId) throw new Error('clientId is required');
            if (!resource) throw new Error('resource is required');
            if (scopes.length === 0) throw new Error('scopes are required');
            return oauthService.updateUserAuthorizationScopes(user, clientId, resource, scopes);
          }
          case 'revoke': {
            const clientId = String(a.clientId ?? '');
            const resource = String(a.resource ?? '');
            if (!clientId) throw new Error('clientId is required');
            if (!resource) throw new Error('resource is required');
            await oauthService.revokeUserAuthorization(user.id, clientId, resource);
            return { revoked: true };
          }
          default:
            throw new Error('Unsupported OAuth authorization operation');
        }
      }
      case 'manage_api_token': {
        const tokensService = container.resolve(TokensService);
        const operation = String(a.operation ?? '');
        switch (operation) {
          case 'list':
            return tokensService.listTokens(user.id);
          case 'create': {
            const input = CreateTokenSchema.parse({
              name: a.name,
              scopes: Array.isArray(a.scopes) ? canonicalizeScopes(a.scopes.map(String)) : a.scopes,
            });
            if (!isScopeSubset(input.scopes, user.scopes)) {
              throw new Error('Cannot create a token with scopes you do not possess');
            }
            return tokensService.createToken(user.id, input);
          }
          case 'update': {
            const tokenId = String(a.tokenId ?? '');
            if (!tokenId) throw new Error('tokenId is required');
            const input = UpdateTokenSchema.parse({
              name: a.name,
              scopes: Array.isArray(a.scopes) ? canonicalizeScopes(a.scopes.map(String)) : a.scopes,
            });
            if (input.scopes !== undefined && !isScopeSubset(input.scopes, user.scopes)) {
              throw new Error('Cannot update a token with scopes you do not possess');
            }
            await tokensService.updateToken(user.id, tokenId, input);
            return { success: true };
          }
          case 'revoke': {
            const tokenId = String(a.tokenId ?? '');
            if (!tokenId) throw new Error('tokenId is required');
            await tokensService.revokeToken(user.id, tokenId);
            return { success: true };
          }
          default:
            throw new Error('Unsupported API token operation');
        }
      }
      case 'get_license_status':
        return container.resolve(LicenseService).getStatus();
      case 'manage_license': {
        const service = container.resolve(LicenseService);
        switch (a.operation) {
          case 'activate':
            return service.activateKey(String(a.licenseKey ?? ''));
          case 'check':
            return service.checkNow();
          case 'clear':
            return service.clearKey();
          default:
            throw new Error('Unsupported license operation');
        }
      }
      case 'manage_housekeeping': {
        const service = container.resolve(HousekeepingService);
        switch (a.operation) {
          case 'get_config':
            return service.getConfig();
          case 'get_stats':
            return service.getStats();
          case 'get_history':
            return service.getRunHistory();
          case 'update_config': {
            this.ensureToolScope(user, 'housekeeping:configure');
            const config = isRecord(a.config) ? a.config : {};
            const updated = await service.updateConfig(config as Parameters<typeof service.updateConfig>[0]);
            if (typeof config.cronExpression === 'string') {
              container.resolve(SchedulerService).updateSchedule('housekeeping', config.cronExpression);
            }
            return updated;
          }
          case 'run':
            this.ensureToolScope(user, 'housekeeping:run');
            return service.runAll('manual', user.id);
          default:
            throw new Error('Unsupported housekeeping operation');
        }
      }
      case 'get_gateway_settings': {
        const authSettingsService = container.resolve(AuthSettingsService);
        const mcpSettingsService = container.resolve(McpSettingsService);
        const generalSettingsService = container.resolve(GeneralSettingsService);
        const networkSettingsService = container.resolve(NetworkSettingsService);
        const outboundWebhookPolicyService = container.resolve(OutboundWebhookPolicyService);
        const [settings, mcpSettings, generalSettings, networkSecurity, outboundWebhookPolicy, groups] =
          await Promise.all([
            authSettingsService.getConfig(),
            mcpSettingsService.getConfig(),
            generalSettingsService.getConfig(),
            networkSettingsService.getConfig(),
            outboundWebhookPolicyService.getConfig(),
            this.groupService.listGroups(),
          ]);
        const availableGroups = groups
          .filter((group) => isScopeSubset(getEffectiveGroupScopes(group), user.scopes))
          .map((group) => ({ id: group.id, name: group.name, isBuiltin: group.isBuiltin }));
        return {
          ...settings,
          mcpServerEnabled: mcpSettings.serverEnabled,
          generalSettings,
          networkSecurity,
          outboundWebhookPolicy,
          availableGroups,
        };
      }
      case 'update_gateway_settings': {
        const input = UpdateAuthProvisioningSettingsSchema.parse(args);
        if (input.oidcDefaultGroupId) {
          const destGroup = await this.groupService.getGroup(input.oidcDefaultGroupId);
          if (!isScopeSubset(getEffectiveGroupScopes(destGroup), user.scopes)) {
            throw new Error('Cannot assign a group with permissions you do not possess');
          }
        }
        const authSettingsService = container.resolve(AuthSettingsService);
        const mcpSettingsService = container.resolve(McpSettingsService);
        const generalSettingsService = container.resolve(GeneralSettingsService);
        const networkSettingsService = container.resolve(NetworkSettingsService);
        const outboundWebhookPolicyService = container.resolve(OutboundWebhookPolicyService);
        const [settings, mcpSettings, generalSettings, networkSecurity, outboundWebhookPolicy] = await Promise.all([
          authSettingsService.updateConfig(input),
          mcpSettingsService.updateConfig({ serverEnabled: input.mcpServerEnabled }),
          input.generalSettings
            ? generalSettingsService.updateConfig(input.generalSettings)
            : generalSettingsService.getConfig(),
          input.networkSecurity
            ? networkSettingsService.updateConfig(input.networkSecurity)
            : networkSettingsService.getConfig(),
          input.outboundWebhookPolicy
            ? outboundWebhookPolicyService.updateConfig(input.outboundWebhookPolicy)
            : outboundWebhookPolicyService.getConfig(),
        ]);
        const groups = await this.groupService.listGroups();
        const availableGroups = groups
          .filter((group) => isScopeSubset(getEffectiveGroupScopes(group), user.scopes))
          .map((group) => ({ id: group.id, name: group.name, isBuiltin: group.isBuiltin }));
        return {
          ...settings,
          mcpServerEnabled: mcpSettings.serverEnabled,
          generalSettings,
          networkSecurity,
          outboundWebhookPolicy,
          availableGroups,
        };
      }
      case 'manage_system_updates': {
        const operation = String(a.operation ?? '');
        const updateService = container.resolve(UpdateService);
        switch (operation) {
          case 'get_gateway_status':
            return updateService.getCachedStatus();
          case 'check_gateway':
            return updateService.checkForUpdates();
          case 'get_gateway_release_notes': {
            const version = String(a.version ?? '');
            if (!/^v?\d+\.\d+\.\d+$/.test(version)) throw new Error('version must be a semantic version');
            return { version, notes: await updateService.getReleaseNotes(version) };
          }
          case 'perform_gateway_update': {
            const version = String(a.version ?? '');
            if (!/^v?\d+\.\d+\.\d+$/.test(version)) throw new Error('version must be a semantic version');
            const status = await updateService.getCachedStatus();
            if (!status.updateAvailable) throw new Error('No gateway update is available');
            if (version !== status.latestVersion) throw new Error('Requested version does not match available update');
            const artifact = await updateService.prepareGatewayUpdate(version);
            const eventBus = container.resolve(EventBusService);
            eventBus.publish('system.update.changed', { updating: true, targetVersion: version });
            setTimeout(() => {
              updateService.performUpdate(version, artifact).catch((error) => {
                eventBus.publish('system.update.changed', { updating: false, targetVersion: version });
                logger.error('Gateway update failed from AI tool', {
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                });
              });
            }, 500);
            return { status: 'updating', targetVersion: version };
          }
          case 'list_daemon_updates':
            return container.resolve(DaemonUpdateService).getCachedStatus();
          case 'check_daemon_updates':
            return container.resolve(DaemonUpdateService).checkForUpdates();
          case 'update_daemon': {
            const nodeId = String(a.nodeId ?? '');
            if (!nodeId) throw new Error('nodeId is required');
            const daemonUpdateService = container.resolve(DaemonUpdateService);
            const db = container.resolve<any>(TOKENS.DrizzleClient);
            const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId)).limit(1);
            if (!node) throw new Error('Node not found');

            const daemonType = node.type as 'nginx' | 'docker' | 'monitoring';
            const release = await daemonUpdateService.getLatestRelease(daemonType);
            if (!release) throw new Error('No release found for this daemon type');

            const arch = (((node.capabilities ?? {}) as Record<string, unknown>).architecture as string) ?? 'amd64';
            const artifact = await daemonUpdateService.prepareTrustedDaemonUpdate(
              daemonType,
              release.tagName,
              release.version,
              arch
            );
            await daemonUpdateService.markNodeUpdateInProgress(nodeId, release.version);
            try {
              const result = await container
                .resolve(NodeDispatchService)
                .sendUpdateDaemonCommand(
                  nodeId,
                  artifact.downloadUrl,
                  release.version,
                  artifact.checksum,
                  artifact.signedManifest
                );
              if (!result.success) {
                await daemonUpdateService.clearNodeUpdateInProgress(nodeId);
                throw new Error(result.error || 'Failed to start daemon update');
              }
            } catch (error) {
              await daemonUpdateService.clearNodeUpdateInProgress(nodeId);
              throw error;
            }

            return { scheduled: true, targetVersion: release.version };
          }
          default:
            throw new Error('Unsupported system update operation');
        }
      }
      case 'get_audit_log':
        return this.auditService.getAuditLog({
          action: a.action,
          resourceType: a.resourceType,
          page: agentPage(a.page),
          limit: agentPageLimit(a.limit),
        });
      case 'get_dashboard_stats': {
        const stats = await this.monitoringService.getDashboardStats(dashboardStatsOptionsForScopes(user.scopes));
        // Filter stats by user's read scopes — don't leak data they can't access
        const filtered: Record<string, unknown> = {};
        if (hasScopeBase(user.scopes, 'proxy:view')) filtered.proxyHosts = stats.proxyHosts;
        if (hasScopeBase(user.scopes, 'ssl:cert:view')) filtered.sslCertificates = stats.sslCertificates;
        if (hasScopeBase(user.scopes, 'pki:cert:view')) filtered.pkiCertificates = stats.pkiCertificates;
        if (hasScope(user.scopes, 'pki:ca:view:root') || hasScope(user.scopes, 'pki:ca:view:intermediate')) {
          filtered.cas = stats.cas;
        }
        if (hasScopeBase(user.scopes, 'nodes:details')) filtered.nodes = stats.nodes;
        if (Object.keys(filtered).length === 0) {
          return {
            message:
              'You do not have permission to view any dashboard statistics. Contact an administrator to get read access to resources.',
          };
        }
        return filtered;
      }

      case 'manage_docker_container_config':
        return manageDockerContainerConfigTool({ dockerService: this.dockerService }, user, args);

      case 'manage_logging':
        return manageLoggingTool(user, args);
      case 'manage_status_page':
        return manageStatusPageTool(user, args);

      // ── Ask Question (handled client-side, backend just passes through) ──
      case 'ask_question':
        return { _askQuestion: true, question: a.question, options: a.options, allowFreeText: a.allowFreeText };

      // ── Documentation ──
      case 'internal_documentation':
        return getInternalDocumentation(a.topic, user.scopes);

      // ── Web Search ──
      case 'web_search':
        return executeWebSearch(this.settingsService, a.query, a.maxResults || 5);

      default:
        throw new Error(`Tool not implemented: ${toolName}`);
    }
  }

  private async discoverTools(user: User, args: Record<string, unknown>) {
    const config = await this.settingsService.getConfig();
    const callableNames = new Set(
      getOpenAITools(config.disabledTools, user.scopes, config.webSearchEnabled, {
        sandboxEnabled: config.sandboxEnabled,
      }).map((tool) => tool.function.name)
    );
    const categoryFilter = stringArg(args.category)?.toLowerCase();
    const query = stringArg(args.query)?.toLowerCase();
    const includeTools = boolArg(args.includeTools) || !!categoryFilter || !!query;

    const callableTools = AI_TOOLS.filter((tool) => callableNames.has(tool.name));
    const categoryMap = new Map<string, { toolCount: number; destructiveCount: number }>();

    for (const tool of callableTools) {
      const current = categoryMap.get(tool.category) ?? { toolCount: 0, destructiveCount: 0 };
      current.toolCount += 1;
      if (tool.destructive) current.destructiveCount += 1;
      categoryMap.set(tool.category, current);
    }

    const categories = [...categoryMap.entries()]
      .map(([name, summary]) => ({ name, ...summary }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const tools = includeTools
      ? callableTools
          .filter((tool) => {
            if (categoryFilter && tool.category.toLowerCase() !== categoryFilter) return false;
            if (!query) return true;
            return [tool.name, tool.category, tool.description, tool.requiredScope]
              .join(' ')
              .toLowerCase()
              .includes(query);
          })
          .map((tool) => ({
            name: tool.name,
            category: tool.category,
            description: tool.description,
            destructive: tool.destructive,
            requiredScope: tool.requiredScope,
            invalidateStores: tool.invalidateStores,
          }))
      : undefined;

    return {
      categories,
      tools,
      discoveredToolsets: includeTools
        ? [...new Set((tools ?? []).map((tool) => tool.category))].sort((a, b) => a.localeCompare(b))
        : [],
      totalCallableTools: callableTools.length,
      note: includeTools
        ? 'Call the selected tool with its documented parameters. Use internal_documentation for workflow details when needed.'
        : 'Pass category, query, or includeTools:true to inspect callable tool details.',
    };
  }

  private async getConversationDiscoveredToolsets(user: User, conversationId?: string): Promise<string[] | undefined> {
    if (!conversationId) return undefined;
    try {
      const conversation = await container.resolve(AIConversationService).getConversation(user.id, conversationId);
      return conversation?.discoveredToolsets ?? [];
    } catch (error) {
      logger.warn('Failed to load AI conversation discovered toolsets', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private buildModelTools(
    config: { disabledTools: string[]; webSearchEnabled: boolean; sandboxEnabled: boolean },
    user: User,
    discoveredToolsets: string[] | undefined
  ) {
    return getOpenAITools(config.disabledTools, user.scopes, config.webSearchEnabled, {
      discoveredToolsets,
      sandboxEnabled: config.sandboxEnabled,
    });
  }

  private async persistToolRuntimeState(
    user: User,
    options: ToolExecutionOptions,
    toolName: string,
    result: unknown
  ): Promise<void> {
    if (!options.conversationId) return;
    const discoveredToolsets = toolName === 'discover_tools' ? discoveredToolsetsFromResult(result) : undefined;

    if (!options.pageContext && (!discoveredToolsets || discoveredToolsets.length === 0)) return;

    try {
      await container.resolve(AIConversationService).updateRuntimeState(user.id, options.conversationId, {
        lastContext: options.pageContext,
        discoveredToolsets,
      });
    } catch (error) {
      logger.warn('Failed to persist AI conversation runtime state', {
        conversationId: options.conversationId,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private ensureToolScope(user: User, scope: string) {
    if (!hasScope(user.scopes, scope)) {
      throw new Error(`PERMISSION_DENIED: Missing required scope ${scope}`);
    }
  }

  private ensureToolScopeForResource(user: User, baseScope: string, resourceId: string) {
    if (!hasScopeForResource(user.scopes, baseScope, resourceId)) {
      throw new Error(`PERMISSION_DENIED: Missing required scope ${baseScope}:${resourceId}`);
    }
  }

  private async toProviderMessage(user: User, message: ChatMessage, config: { supportsImages: boolean }) {
    const msg: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.role === 'user' && config.supportsImages && message.attachments?.length && this.artifactService) {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ type: 'text', text: message.content });
      const imageParts: Array<Record<string, unknown> | null> = await Promise.all(
        message.attachments
          .filter((attachment) => attachment.kind === 'image')
          .map((attachment) => this.attachmentToImagePart(user.id, attachment))
      );
      parts.push(...imageParts.filter((part): part is Record<string, unknown> => part !== null));
      if (parts.length > 0) msg.content = parts;
    }
    if (message.tool_calls) msg.tool_calls = message.tool_calls;
    if (message.tool_call_id) msg.tool_call_id = message.tool_call_id;
    if (message.name) msg.name = message.name;
    return msg;
  }

  private async attachmentToImagePart(
    userId: string,
    attachment: AIMessageAttachment
  ): Promise<Record<string, unknown> | null> {
    if (!attachment.mediaType.startsWith('image/')) return null;
    try {
      const artifact = await this.artifactService?.getDownload(userId, attachment.artifactId);
      if (!artifact) return null;
      const buffer = await fs.readFile(artifact.filePath);
      const dataUrl = `data:${artifact.metadata.mediaType};base64,${buffer.toString('base64')}`;
      return { type: 'image_url', image_url: { url: dataUrl } };
    } catch (error) {
      logger.warn('Failed to attach AI message image artifact', {
        artifactId: attachment.artifactId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Stream a chat completion with tool calling.
   * Yields WSServerMessage events for the WebSocket handler to forward.
   */
  async *streamChat(
    user: User,
    clientMessages: ChatMessage[],
    pageContext: PageContext | undefined,
    signal: AbortSignal,
    requestId: string,
    conversationId?: string
  ): AsyncGenerator<WSServerMessage> {
    const config = await this.settingsService.getConfig();
    const apiKey = await this.settingsService.getDecryptedApiKey();
    if (!apiKey) {
      yield { type: 'error', requestId, message: 'AI is not configured. An admin must set up the API key.' };
      yield { type: 'done', requestId };
      return;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: config.providerUrl || undefined,
    });

    const systemPrompt = await this.buildSystemPrompt(user, pageContext);
    let discoveredToolsets = await this.getConversationDiscoveredToolsets(user, conversationId);
    let tools = this.buildModelTools(config, user, discoveredToolsets);

    // Build messages array: system + client messages
    let messages: Record<string, unknown>[] = [
      { role: 'system', content: systemPrompt },
      ...(await Promise.all(clientMessages.map((message) => this.toProviderMessage(user, message, config)))),
    ];

    const maxContextTokens = config.maxContextTokens;
    const maxRounds = config.maxToolRounds;

    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) return;

      messages = trimToTokenBudget(messages, maxContextTokens);

      let contentBuffer = '';
      let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      try {
        for await (const event of streamModelResponse({ client, config, messages, tools, signal })) {
          if (event.type === 'text_delta') {
            contentBuffer += event.content;
            yield { type: 'text_delta', requestId, content: event.content };
          } else {
            contentBuffer = event.response.content;
            toolCalls = event.response.toolCalls;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Stream error';
        logger.error('OpenAI API error', { error: err });
        if (isContextWindowError(err)) {
          yield {
            type: 'context_blocked',
            requestId,
            reason:
              'This chat has run out of usable context and could not be compacted automatically. Clear part of the oldest context or start a new chat.',
          };
          yield { type: 'done', requestId };
          return;
        }
        yield { type: 'error', requestId, message };
        yield { type: 'done', requestId };
        return;
      }

      // If no tool calls, we're done
      toolCalls = toolCalls.filter((tc) => tc.id && tc.name);
      if (toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: contentBuffer });
        yield { type: 'done', requestId };
        return;
      }

      // Process tool calls
      const rawToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));

      messages.push({
        role: 'assistant',
        content: contentBuffer || null,
        tool_calls: rawToolCalls,
      });

      // Parse all tool args first
      const parsedToolCalls = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || '{}');
        } catch {
          /* empty */
        }
        return { ...tc, parsedArgs };
      });

      // Separate questions, tools that require approval, and immediate tools.
      const questionTools: typeof parsedToolCalls = [];
      const approvalTools: typeof parsedToolCalls = [];

      for (const tc of parsedToolCalls) {
        if (tc.name === 'ask_question') {
          questionTools.push(tc);
          continue;
        }
        if (getAIToolApprovalDecision(tc.name, user.aiApprovalMode).requiresApproval) {
          approvalTools.push(tc);
          continue;
        }

        yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };

        const result = await this.executeTool(user, tc.name, tc.parsedArgs, { pageContext, conversationId });
        if (tc.name === 'discover_tools') {
          discoveredToolsets = mergeToolsets(discoveredToolsets ?? [], discoveredToolsetsFromResult(result.result));
          tools = this.buildModelTools(config, user, discoveredToolsets);
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.error || compactToolResultForModel(tc.name, result.result)),
        });
        yield {
          type: 'tool_result',
          requestId,
          id: tc.id,
          name: tc.name,
          result: result.result,
          error: result.error,
        };
        if (result.invalidateStores.length > 0) {
          yield { type: 'invalidate_stores', requestId, stores: result.invalidateStores };
        }
        if (tc.name === 'end_conversation' && !result.error) {
          yield {
            type: 'conversation_ended',
            requestId,
            reason: conversationEndReason(result.result, 'This conversation has been ended.'),
          };
          yield { type: 'done', requestId };
          return;
        }
      }

      // Questions take priority over destructive tools — show all questions first
      if (questionTools.length > 0) {
        for (const tc of questionTools) {
          yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };
        }
        // Pause with the first question; frontend will collect all answers
        const first = questionTools[0];
        yield {
          type: 'tool_approval_required',
          requestId,
          id: first.id,
          name: 'ask_question',
          arguments: first.parsedArgs,
          _pendingMessages: messages,
          _allQuestions: questionTools.map((q) => ({ id: q.id, args: q.parsedArgs })),
        } as any;
        return;
      }

      // Approval pause. Queue later approval-gated calls instead of returning fake "skipped" tool results.
      if (approvalTools.length > 0) {
        const [approvalTool, ...queued] = approvalTools;
        yield {
          type: 'tool_call_start',
          requestId,
          id: approvalTool.id,
          name: approvalTool.name,
          arguments: approvalTool.parsedArgs,
        };
        yield {
          type: 'tool_approval_required',
          requestId,
          id: approvalTool.id,
          name: approvalTool.name,
          arguments: approvalTool.parsedArgs,
          _pendingMessages: messages,
          _queuedApprovals: queued.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.parsedArgs })),
        } as any;
        return;
      }

      // Continue to next round (LLM will see tool results)
    }

    yield { type: 'done', requestId };
  }

  /**
   * Resume streaming after a destructive tool approval/rejection.
   */
  async *resumeAfterApproval(
    user: User,
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    approved: boolean,
    pendingMessages: Record<string, unknown>[],
    pageContext: PageContext | undefined,
    signal: AbortSignal,
    requestId: string,
    answer?: string,
    answers?: Record<string, string>,
    queuedApprovals: QueuedApproval[] = [],
    conversationId?: string
  ): AsyncGenerator<WSServerMessage> {
    if (toolName === 'ask_question') {
      // Batch answers: { toolCallId: answer, ... }
      const allAnswers: Record<string, string> = { ...answers };
      if (answer) allAnswers[toolCallId] = answer;
      // Only inject answers for tool calls that don't already have a response in pendingMessages
      const existingToolResultIds = new Set(
        pendingMessages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id as string)
      );
      for (const [tcId, ans] of Object.entries(allAnswers)) {
        if (existingToolResultIds.has(tcId)) continue; // Already responded in a previous round
        const answerText = ans || 'No answer provided';
        pendingMessages.push({ role: 'tool', tool_call_id: tcId, content: JSON.stringify({ answer: answerText }) });
        yield { type: 'tool_result', requestId, id: tcId, name: 'ask_question', result: { answer: answerText } };
      }
    } else if (!approved) {
      pendingMessages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({ error: 'User rejected this action.' }),
      });
      yield {
        type: 'tool_result',
        requestId,
        id: toolCallId,
        name: toolName,
        result: undefined,
        error: 'Rejected by user',
      };
    } else {
      const result = await this.executeTool(user, toolName, toolArgs, { pageContext, conversationId });
      pendingMessages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result.error || compactToolResultForModel(toolName, result.result)),
      });
      yield {
        type: 'tool_result',
        requestId,
        id: toolCallId,
        name: toolName,
        result: result.result,
        error: result.error,
      };
      if (result.invalidateStores.length > 0) {
        yield { type: 'invalidate_stores', requestId, stores: result.invalidateStores };
      }
      if (toolName === 'end_conversation' && !result.error) {
        yield {
          type: 'conversation_ended',
          requestId,
          reason: conversationEndReason(result.result, 'This conversation has been ended.'),
        };
        yield { type: 'done', requestId };
        return;
      }
    }

    if (queuedApprovals.length > 0) {
      const [nextApproval, ...remainingApprovals] = queuedApprovals;
      yield {
        type: 'tool_call_start',
        requestId,
        id: nextApproval.id,
        name: nextApproval.name,
        arguments: nextApproval.arguments,
      };
      yield {
        type: 'tool_approval_required',
        requestId,
        id: nextApproval.id,
        name: nextApproval.name,
        arguments: nextApproval.arguments,
        _pendingMessages: pendingMessages,
        _queuedApprovals: remainingApprovals,
      } as any;
      return;
    }

    // Continue streaming with the updated messages
    const config = await this.settingsService.getConfig();
    const apiKey = await this.settingsService.getDecryptedApiKey();
    if (!apiKey) {
      yield { type: 'done', requestId };
      return;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: config.providerUrl || undefined,
    });

    let discoveredToolsets = await this.getConversationDiscoveredToolsets(user, conversationId);
    let tools = this.buildModelTools(config, user, discoveredToolsets);
    const messages = trimToTokenBudget(pendingMessages, config.maxContextTokens);

    // Continue with remaining rounds
    const maxRounds = config.maxToolRounds;
    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) return;

      let contentBuffer = '';
      let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      try {
        for await (const event of streamModelResponse({ client, config, messages, tools, signal })) {
          if (event.type === 'text_delta') {
            contentBuffer += event.content;
            yield { type: 'text_delta', requestId, content: event.content };
          } else {
            contentBuffer = event.response.content;
            toolCalls = event.response.toolCalls;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Stream error';
        logger.error('OpenAI API error', { error: err });
        if (isContextWindowError(err)) {
          yield {
            type: 'context_blocked',
            requestId,
            reason:
              'This chat has run out of usable context and could not be compacted automatically. Clear part of the oldest context or start a new chat.',
          };
          yield { type: 'done', requestId };
          return;
        }
        yield { type: 'error', requestId, message };
        yield { type: 'done', requestId };
        return;
      }

      toolCalls = toolCalls.filter((tc) => tc.id && tc.name);
      if (toolCalls.length === 0) {
        yield { type: 'done', requestId };
        return;
      }

      // Process tool calls
      const rawToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));

      messages.push({ role: 'assistant', content: contentBuffer || null, tool_calls: rawToolCalls });

      const parsedToolCalls = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || '{}');
        } catch {
          /* empty */
        }
        return { ...tc, parsedArgs };
      });

      const questionTools2: typeof parsedToolCalls = [];
      const approvalTools2: typeof parsedToolCalls = [];

      for (const tc of parsedToolCalls) {
        if (tc.name === 'ask_question') {
          questionTools2.push(tc);
          continue;
        }
        if (getAIToolApprovalDecision(tc.name, user.aiApprovalMode).requiresApproval) {
          approvalTools2.push(tc);
          continue;
        }

        yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };
        const result = await this.executeTool(user, tc.name, tc.parsedArgs, { pageContext, conversationId });
        if (tc.name === 'discover_tools') {
          discoveredToolsets = mergeToolsets(discoveredToolsets ?? [], discoveredToolsetsFromResult(result.result));
          tools = this.buildModelTools(config, user, discoveredToolsets);
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.error || compactToolResultForModel(tc.name, result.result)),
        });
        yield {
          type: 'tool_result',
          requestId,
          id: tc.id,
          name: tc.name,
          result: result.result,
          error: result.error,
        };
        if (result.invalidateStores.length > 0) {
          yield { type: 'invalidate_stores', requestId, stores: result.invalidateStores };
        }
        if (tc.name === 'end_conversation' && !result.error) {
          yield {
            type: 'conversation_ended',
            requestId,
            reason: conversationEndReason(result.result, 'This conversation has been ended.'),
          };
          yield { type: 'done', requestId };
          return;
        }
      }

      if (questionTools2.length > 0) {
        for (const tc of questionTools2) {
          yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };
        }
        const first = questionTools2[0];
        yield {
          type: 'tool_approval_required',
          requestId,
          id: first.id,
          name: 'ask_question',
          arguments: first.parsedArgs,
          _pendingMessages: messages,
          _allQuestions: questionTools2.map((q) => ({ id: q.id, args: q.parsedArgs })),
        } as any;
        return;
      }

      if (approvalTools2.length > 0) {
        const [approvalTool2, ...queued] = approvalTools2;
        yield {
          type: 'tool_call_start',
          requestId,
          id: approvalTool2.id,
          name: approvalTool2.name,
          arguments: approvalTool2.parsedArgs,
        };
        yield {
          type: 'tool_approval_required',
          requestId,
          id: approvalTool2.id,
          name: approvalTool2.name,
          arguments: approvalTool2.parsedArgs,
          _pendingMessages: messages,
          _queuedApprovals: queued.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.parsedArgs })),
        } as any;
        return;
      }
    }

    yield { type: 'done', requestId };
  }

  /**
   * Get context size estimate for /context command.
   */
  async getContextEstimate(
    user: User,
    pageContext?: PageContext
  ): Promise<{
    systemTokens: number;
    toolsTokens: number;
    totalOverhead: number;
  }> {
    const prompt = await this.buildSystemPrompt(user, pageContext);
    const systemTokens = estimateTokens(prompt);
    const toolsTokens = 3000;
    return { systemTokens, toolsTokens, totalOverhead: systemTokens + toolsTokens };
  }
}
