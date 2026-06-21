import OpenAI from 'openai';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope, hasScopeBase, hasScopeForResource } from '@/lib/permissions.js';
import type { AccessListService } from '@/modules/access-lists/access-list.service.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { AuthService } from '@/modules/auth/auth.service.js';
import type { DatabaseConnectionService } from '@/modules/databases/databases.service.js';
import type { DockerManagementService } from '@/modules/docker/docker.service.js';
import type { DomainsService } from '@/modules/domains/domain.service.js';
import type { GroupService } from '@/modules/groups/group.service.js';
import type { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import type { NodesService } from '@/modules/nodes/nodes.service.js';
import { CreateIntermediateCASchema, CreateRootCASchema, UpdateCASchema } from '@/modules/pki/ca.schemas.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import {
  ExportCertificateQuerySchema,
  IssueCertFromCSRSchema,
  IssueCertificateSchema,
} from '@/modules/pki/cert.schemas.js';
import type { CertService } from '@/modules/pki/cert.service.js';
import type { TemplatesService } from '@/modules/pki/templates.service.js';
import type { FolderService } from '@/modules/proxy/folder.service.js';
import { CreateNginxTemplateSchema, UpdateNginxTemplateSchema } from '@/modules/proxy/nginx-template.schemas.js';
import type { ProxyService } from '@/modules/proxy/proxy.service.js';
import { UploadCertSchema } from '@/modules/ssl/ssl.schemas.js';
import type { SSLService } from '@/modules/ssl/ssl.service.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';
import { ACCESS_LIST_TOOL_NAMES, executeAccessListTool } from './ai.access-list-tools.js';
import { DATABASE_TOOL_NAMES, executeDatabaseTool } from './ai.database-tools.js';
import { manageDockerContainerConfigTool } from './ai.docker-config-tools.js';
import { DOCKER_TOOL_NAMES, executeDockerTool } from './ai.docker-tools.js';
import { getInternalDocumentation } from './ai.docs.js';
import { DOMAIN_TOOL_NAMES, executeDomainTool } from './ai.domain-tools.js';
import { executeGroupTool, GROUP_TOOL_NAMES } from './ai.group-tools.js';
import { manageLoggingTool } from './ai.logging-tools.js';
import { executeNodeTool, NODE_TOOL_NAMES } from './ai.node-tools.js';
import { executeNotificationTool, NOTIFICATION_TOOL_NAMES } from './ai.notification-tools.js';
import { executePkiTemplateTool, PKI_TEMPLATE_TOOL_NAMES } from './ai.pki-template-tools.js';
import { findResource } from './ai.resource-search.js';
import {
  agentPage,
  agentPageLimit,
  allowedResourceIdsForScopes,
  caTypeRevokeScope,
  caTypeViewScope,
  compactProxyHostForAgent,
  dashboardStatsOptionsForScopes,
  estimateTokens,
  getToolResourceId,
  hasToolExecutionScope,
  isMutatingTool,
  PROXY_HOST_UPDATE_FIELDS,
  redactToolArgs,
  trimToTokenBudget,
} from './ai.service-helpers.js';
import type { AISettingsService } from './ai.settings.service.js';
import { manageStatusPageTool } from './ai.status-page-tools.js';
import { buildAISystemPrompt } from './ai.system-prompt.js';
import { AI_TOOLS, getOpenAITools, isDestructiveTool, TOOL_STORE_INVALIDATION_MAP } from './ai.tools.js';
import type {
  ChatMessage,
  PageContext,
  ToolExecutionOptions,
  ToolExecutionResult,
  WSServerMessage,
} from './ai.types.js';
import { executeWebSearch } from './ai.web-search.js';

const logger = createChildLogger('AIService');

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
    private readonly notifDispatcherService?: import('@/modules/notifications/notification-dispatcher.service.js').NotificationDispatcherService
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
      const result = await this.executeToolInternal(executionUser, toolName, args);
      const invalidateStores = TOOL_STORE_INVALIDATION_MAP[toolName] || [];

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeToolInternal(user: User, toolName: string, args: Record<string, unknown>): Promise<unknown> {
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
    if (NODE_TOOL_NAMES.has(toolName)) {
      return executeNodeTool({ nodesService: this.nodesService }, user, toolName, args);
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

    switch (toolName) {
      // ── Discovery ──
      case 'find_resource':
        return findResource(
          {
            executeToolInternal: (executionUser, delegatedToolName, delegatedArgs) =>
              this.executeToolInternal(executionUser, delegatedToolName, delegatedArgs),
            nodesService: this.nodesService,
          },
          user,
          args
        );

      // ── PKI - CAs ──
      case 'list_cas':
        return (await this.caService.getCATree()).filter((ca: { type: string }) =>
          hasScope(user.scopes, caTypeViewScope(ca.type))
        );
      case 'get_ca': {
        const ca = await this.caService.getCA(a.caId);
        if (!hasScope(user.scopes, caTypeViewScope(ca.type))) {
          throw new Error(`PERMISSION_DENIED: Missing required scope ${caTypeViewScope(ca.type)}`);
        }
        return ca;
      }
      case 'create_root_ca': {
        const rootCaInput = CreateRootCASchema.parse(args);
        return this.caService.createRootCA(rootCaInput, user.id);
      }
      case 'create_intermediate_ca': {
        const intCaInput = CreateIntermediateCASchema.parse(args);
        return this.caService.createIntermediateCA(a.parentCaId, intCaInput, user.id);
      }
      case 'delete_ca': {
        const ca = await this.caService.getCA(a.caId);
        const requiredScope = caTypeRevokeScope(ca.type);
        if (!hasScope(user.scopes, requiredScope)) {
          throw new Error(`PERMISSION_DENIED: Missing required scope ${requiredScope}`);
        }
        await this.caService.deleteCA(a.caId, user.id);
        return { success: true };
      }
      case 'manage_ca': {
        const ca = await this.caService.getCA(a.caId);
        const requiredScope = ca.type === 'root' ? 'pki:ca:create:root' : 'pki:ca:create:intermediate';
        if (!hasScope(user.scopes, requiredScope)) {
          throw new Error(`PERMISSION_DENIED: Missing required scope ${requiredScope}`);
        }
        if (a.operation === 'update') {
          return this.caService.updateCA(a.caId, UpdateCASchema.parse(args), user.id);
        }
        throw new Error(`Unsupported CA operation: ${String(a.operation)}`);
      }

      // ── PKI - Certificates ──
      case 'list_certificates':
        return this.certService.listCertificates(
          {
            caId: a.caId,
            status: a.status,
            search: a.search,
            page: agentPage(a.page),
            limit: agentPageLimit(a.limit),
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
          { allowedIds: allowedResourceIdsForScopes(user.scopes, 'pki:cert:view') }
        );
      case 'get_certificate':
        return this.certService.getCertificate(a.certificateId);
      case 'issue_certificate': {
        const certInput = IssueCertificateSchema.parse(args);
        const result = await this.certService.issueCertificate(certInput, user.id);
        return {
          certificate: result.certificate,
          message: 'Certificate issued successfully. Private key was generated.',
        };
      }
      case 'revoke_certificate':
        await this.certService.revokeCertificate(a.certificateId, a.reason, user.id);
        return { success: true, message: 'Certificate revoked.' };
      case 'manage_certificate': {
        if (a.operation === 'issue_from_csr') {
          this.ensureToolScope(user, 'pki:cert:issue');
          return this.certService.issueCertificateFromCSR(IssueCertFromCSRSchema.parse(args), user.id);
        }
        if (a.operation === 'chain') {
          this.ensureToolScopeForResource(user, 'pki:cert:view', String(a.certificateId));
          const cert = await this.certService.getCertificate(a.certificateId);
          const chainPems: string[] = [];
          let currentCaId: string | null = cert.caId;
          while (currentCaId) {
            const ca = await this.caService.getCA(currentCaId);
            chainPems.push(ca.certificatePem);
            currentCaId = ca.parentId;
          }
          return { certificatePem: cert.certificatePem, chainPem: [cert.certificatePem, ...chainPems].join('\n') };
        }
        if (a.operation === 'export') {
          this.ensureToolScopeForResource(user, 'pki:cert:export', String(a.certificateId));
          const input = ExportCertificateQuerySchema.parse(args);
          const cert = await this.certService.getCertificate(a.certificateId);
          const { ExportService } = await import('@/modules/pki/export.service.js');
          const exportService = container.resolve(ExportService);
          if (input.format === 'pem') return { format: 'pem', content: cert.certificatePem };
          if (input.format === 'der') {
            return { format: 'der', contentBase64: exportService.exportDER(cert.certificatePem).toString('base64') };
          }
          if (!input.passphrase) throw new Error('PASSPHRASE_REQUIRED');
          const privateKey = await this.certService.getCertificatePrivateKey(a.certificateId);
          if (input.format === 'pkcs12') {
            if (!privateKey) throw new Error('NO_PRIVATE_KEY');
            return {
              format: 'pkcs12',
              contentBase64: exportService
                .exportPKCS12(cert.certificatePem, privateKey, input.passphrase)
                .toString('base64'),
            };
          }
          return {
            format: 'jks',
            contentBase64: exportService
              .exportJKS(cert.certificatePem, privateKey, input.passphrase, cert.commonName)
              .toString('base64'),
          };
        }
        throw new Error(`Unsupported certificate operation: ${String(a.operation)}`);
      }

      // ── Reverse Proxy ──
      case 'list_proxy_hosts': {
        const result = await this.proxyService.listProxyHosts(
          {
            search: a.search,
            page: agentPage(a.page),
            limit: agentPageLimit(a.limit),
          },
          { allowedIds: allowedResourceIdsForScopes(user.scopes, 'proxy:view') }
        );
        return {
          ...result,
          data: result.data.map((host: any) => compactProxyHostForAgent(host)),
        };
      }
      case 'get_proxy_host':
        return compactProxyHostForAgent(await this.proxyService.getProxyHost(a.proxyHostId));
      case 'create_proxy_host':
        return compactProxyHostForAgent(
          await this.proxyService.createProxyHost(
            {
              type: a.type || 'proxy',
              nodeId: a.nodeId,
              domainNames: a.domainNames,
              forwardHost: a.forwardHost,
              forwardPort: a.forwardPort,
              forwardScheme: a.forwardScheme || 'http',
              sslEnabled: a.sslEnabled || false,
              sslForced: a.sslForced || false,
              http2Support: a.http2Support || false,
              websocketSupport: a.websocketSupport || false,
              sslCertificateId: a.sslCertificateId,
              redirectUrl: a.redirectUrl,
              redirectStatusCode: a.redirectStatusCode,
              customHeaders: a.customHeaders || [],
              cacheEnabled: a.cacheEnabled || false,
              cacheOptions: a.cacheOptions,
              rateLimitEnabled: a.rateLimitEnabled || false,
              rateLimitOptions: a.rateLimitOptions,
              customRewrites: [],
              accessListId: a.accessListId,
              nginxTemplateId: a.nginxTemplateId,
              templateVariables: a.templateVariables,
              healthCheckEnabled: a.healthCheckEnabled || false,
              healthCheckUrl: a.healthCheckUrl,
              healthCheckInterval: a.healthCheckInterval,
              healthCheckExpectedStatus: a.healthCheckExpectedStatus,
              healthCheckExpectedBody: a.healthCheckExpectedBody,
            },
            user.id
          )
        );
      case 'update_proxy_host': {
        const { proxyHostId, advancedConfig: _ac } = a;
        if ('rawConfig' in a || 'rawConfigEnabled' in a || a.type === 'raw') {
          throw new Error('Raw config changes require dedicated raw config tools');
        }
        if (_ac && !hasScope(user.scopes, `proxy:advanced:${proxyHostId}`)) {
          throw new Error('Advanced config requires proxy:advanced scope');
        }
        const updateFields = PROXY_HOST_UPDATE_FIELDS.reduce<Record<string, unknown>>((fields, field) => {
          if (a[field] !== undefined) fields[field] = a[field];
          return fields;
        }, {});
        const bypassAdvancedValidation = hasScope(user.scopes, `proxy:advanced:bypass:${proxyHostId}`);
        const fields =
          _ac && hasScope(user.scopes, `proxy:advanced:${proxyHostId}`)
            ? { ...updateFields, advancedConfig: _ac }
            : updateFields;
        return compactProxyHostForAgent(
          await this.proxyService.updateProxyHost(proxyHostId, fields, user.id, { bypassAdvancedValidation })
        );
      }
      case 'delete_proxy_host':
        await this.proxyService.deleteProxyHost(a.proxyHostId, user.id);
        return { success: true };

      // ── Proxy Folders ──
      case 'create_proxy_folder':
        return this.folderService.createFolder({ name: a.name, parentId: a.parentId }, user.id);
      case 'move_hosts_to_folder':
        for (const hostId of a.hostIds || []) {
          if (!hasScope(user.scopes, `proxy:edit:${hostId}`)) {
            throw new Error(`PERMISSION_DENIED: Missing required scope proxy:edit:${hostId}`);
          }
        }
        return this.folderService.moveHostsToFolder({ hostIds: a.hostIds, folderId: a.folderId }, user.id);
      case 'delete_proxy_folder':
        await this.folderService.deleteFolder(a.folderId, user.id);
        return { success: true };
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

  /**
   * Stream a chat completion with tool calling.
   * Yields WSServerMessage events for the WebSocket handler to forward.
   */
  async *streamChat(
    user: User,
    clientMessages: ChatMessage[],
    pageContext: PageContext | undefined,
    signal: AbortSignal,
    requestId: string
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
    const tools = getOpenAITools(config.disabledTools, user.scopes, config.webSearchEnabled);

    // Build messages array: system + client messages
    let messages: Record<string, unknown>[] = [
      { role: 'system', content: systemPrompt },
      ...clientMessages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      }),
    ];

    const maxContextTokens = config.maxContextTokens;
    const maxRounds = config.maxToolRounds;

    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) return;

      messages = trimToTokenBudget(messages, maxContextTokens);

      let stream: Awaited<ReturnType<typeof client.chat.completions.create>> | undefined;
      try {
        stream = await client.chat.completions.create({
          model: config.model || 'gpt-4o',
          messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
          tools: tools.length > 0 ? (tools as OpenAI.ChatCompletionTool[]) : undefined,
          stream: true,
          ...(config.maxTokensField === 'max_tokens'
            ? { max_tokens: config.maxCompletionTokens }
            : { max_completion_tokens: config.maxCompletionTokens }),
          ...(config.reasoningEffort && config.reasoningEffort !== 'none'
            ? ({ reasoning_effort: config.reasoningEffort } as Record<string, unknown>)
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to call AI provider';
        logger.error('OpenAI API error', { error: err });
        yield { type: 'error', requestId, message };
        yield { type: 'done', requestId };
        return;
      }

      let contentBuffer = '';
      const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let hasToolCalls = false;

      try {
        for await (const chunk of stream) {
          if (signal.aborted) return;

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            contentBuffer += delta.content;
            yield { type: 'text_delta', requestId, content: delta.content };
          }

          // Tool calls (accumulated incrementally)
          if (delta.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccumulators.has(idx)) {
                toolCallAccumulators.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
              }
              const acc = toolCallAccumulators.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Stream error';
        yield { type: 'error', requestId, message };
        yield { type: 'done', requestId };
        return;
      }

      // If no tool calls, we're done
      if (!hasToolCalls) {
        messages.push({ role: 'assistant', content: contentBuffer });
        yield { type: 'done', requestId };
        return;
      }

      // Process tool calls
      const toolCalls = Array.from(toolCallAccumulators.values());
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

      // Separate: questions, destructive (first only), and immediate tools
      const questionTools: typeof parsedToolCalls = [];
      let destructiveTool: (typeof parsedToolCalls)[number] | null = null;

      for (const tc of parsedToolCalls) {
        if (tc.name === 'ask_question') {
          questionTools.push(tc);
          continue;
        }
        if (isDestructiveTool(tc.name) && !destructiveTool) {
          destructiveTool = tc;
          continue;
        }

        yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };

        if (isDestructiveTool(tc.name)) {
          // Additional destructive tool — skip
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ skipped: 'Another action is pending approval.' }),
          });
          yield {
            type: 'tool_result',
            requestId,
            id: tc.id,
            name: tc.name,
            result: { skipped: 'Another action is pending approval.' },
          };
        } else {
          const result = await this.executeTool(user, tc.name, tc.parsedArgs);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result.error || result.result) });
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

      // Destructive tool pause
      if (destructiveTool) {
        yield {
          type: 'tool_call_start',
          requestId,
          id: destructiveTool.id,
          name: destructiveTool.name,
          arguments: destructiveTool.parsedArgs,
        };
        yield {
          type: 'tool_approval_required',
          requestId,
          id: destructiveTool.id,
          name: destructiveTool.name,
          arguments: destructiveTool.parsedArgs,
          _pendingMessages: messages,
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
    _pageContext: PageContext | undefined,
    signal: AbortSignal,
    requestId: string,
    answer?: string,
    answers?: Record<string, string>
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
      const result = await this.executeTool(user, toolName, toolArgs);
      pendingMessages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result.error || result.result),
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

    const tools = getOpenAITools(config.disabledTools, user.scopes, config.webSearchEnabled);
    const messages = trimToTokenBudget(pendingMessages, config.maxContextTokens);

    // Continue with remaining rounds
    const maxRounds = config.maxToolRounds;
    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) return;

      let stream: Awaited<ReturnType<typeof client.chat.completions.create>> | undefined;
      try {
        stream = await client.chat.completions.create({
          model: config.model || 'gpt-4o',
          messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
          tools: tools.length > 0 ? (tools as OpenAI.ChatCompletionTool[]) : undefined,
          stream: true,
          ...(config.maxTokensField === 'max_tokens'
            ? { max_tokens: config.maxCompletionTokens }
            : { max_completion_tokens: config.maxCompletionTokens }),
          ...(config.reasoningEffort && config.reasoningEffort !== 'none'
            ? ({ reasoning_effort: config.reasoningEffort } as Record<string, unknown>)
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to call AI provider';
        yield { type: 'error', requestId, message };
        yield { type: 'done', requestId };
        return;
      }

      let contentBuffer = '';
      const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let hasToolCalls = false;

      try {
        for await (const chunk of stream) {
          if (signal.aborted) return;
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            contentBuffer += delta.content;
            yield { type: 'text_delta', requestId, content: delta.content };
          }

          if (delta.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccumulators.has(idx)) {
                toolCallAccumulators.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
              }
              const acc = toolCallAccumulators.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        yield { type: 'error', requestId, message: err instanceof Error ? err.message : 'Stream error' };
        yield { type: 'done', requestId };
        return;
      }

      if (!hasToolCalls) {
        yield { type: 'done', requestId };
        return;
      }

      // Process tool calls
      const toolCalls = Array.from(toolCallAccumulators.values());
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
      let destructiveTool2: (typeof parsedToolCalls)[number] | null = null;

      for (const tc of parsedToolCalls) {
        if (tc.name === 'ask_question') {
          questionTools2.push(tc);
          continue;
        }
        if (isDestructiveTool(tc.name) && !destructiveTool2) {
          destructiveTool2 = tc;
          continue;
        }

        yield { type: 'tool_call_start', requestId, id: tc.id, name: tc.name, arguments: tc.parsedArgs };
        if (isDestructiveTool(tc.name)) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ skipped: 'Another action is pending approval.' }),
          });
          yield {
            type: 'tool_result',
            requestId,
            id: tc.id,
            name: tc.name,
            result: { skipped: 'Another action is pending approval.' },
          };
        } else {
          const result = await this.executeTool(user, tc.name, tc.parsedArgs);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result.error || result.result) });
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

      if (destructiveTool2) {
        yield {
          type: 'tool_call_start',
          requestId,
          id: destructiveTool2.id,
          name: destructiveTool2.name,
          arguments: destructiveTool2.parsedArgs,
        };
        yield {
          type: 'tool_approval_required',
          requestId,
          id: destructiveTool2.id,
          name: destructiveTool2.name,
          arguments: destructiveTool2.parsedArgs,
          _pendingMessages: messages,
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
