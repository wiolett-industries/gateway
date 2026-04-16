import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { accessLists } from '@/db/schema/access-lists.js';
import { certificates } from '@/db/schema/certificates.js';
import { proxyHosts } from '@/db/schema/index.js';
import { sslCertificates } from '@/db/schema/ssl-certificates.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere, escapeLike } from '@/lib/utils.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NginxConfigGenerator, ProxyHostConfig } from '@/services/nginx-config-generator.service.js';
import type { NginxSyntaxValidatorService } from '@/services/nginx-syntax-validator.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { PaginatedResponse } from '@/types.js';
import type { NginxTemplateService } from './nginx-template.service.js';
import type { CreateProxyHostInput, ProxyHostListQuery, UpdateProxyHostInput } from './proxy.schemas.js';

const logger = createChildLogger('ProxyService');

type HealthCheckBodyMatchMode = 'includes' | 'exact' | 'starts_with' | 'ends_with';

function matchesExpectedBody(body: string, expectedBody: string, mode: HealthCheckBodyMatchMode): boolean {
  switch (mode) {
    case 'exact':
      return body === expectedBody;
    case 'starts_with':
      return body.startsWith(expectedBody);
    case 'ends_with':
      return body.endsWith(expectedBody);
    default:
      return body.includes(expectedBody);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProxyHostRow = typeof proxyHosts.$inferSelect;

interface CertPaths {
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProxyService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly nginxTemplateService: NginxTemplateService,
    private readonly auditService: AuditService,
    private readonly cryptoService: CryptoService,
    private readonly configGenerator: NginxConfigGenerator,
    private readonly nodeDispatch: NodeDispatchService,
    private readonly nginxSyntaxValidator: NginxSyntaxValidatorService
  ) {}

  private eventBus?: EventBusService;
  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }
  private emitHost(id: string, action: string, domain?: string) {
    this.eventBus?.publish('proxy.host.changed', { id, action, domain });
  }

  private async applyConfigToNode(hostId: string, config: string, nodeId: string | null): Promise<void> {
    const resolvedNodeId = await this.nodeDispatch.resolveNodeId(nodeId);
    const result = await this.nodeDispatch.applyConfig(resolvedNodeId, hostId, config);
    if (!result.success) {
      throw new Error(result.error || 'Daemon config apply failed');
    }
    await this.auditService.log({
      userId: null,
      action: 'node.config_push',
      resourceType: 'proxy_host',
      resourceId: hostId,
      details: { nodeId: resolvedNodeId },
    });
  }

  private async removeConfigFromNode(hostId: string, nodeId: string | null): Promise<void> {
    const resolvedNodeId = await this.nodeDispatch.resolveNodeId(nodeId);
    const result = await this.nodeDispatch.removeConfig(resolvedNodeId, hostId);
    if (!result.success) {
      throw new Error(result.error || 'Daemon config remove failed');
    }
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  async createProxyHost(input: CreateProxyHostInput, userId: string) {
    // 0. Require a node assignment
    if (!input.nodeId) {
      throw new AppError(400, 'NODE_REQUIRED', 'A node must be selected for the proxy host');
    }

    // 0b. Validate advanced config if provided
    if (input.advancedConfig) {
      const validation = this.configGenerator.validateAdvancedConfig(input.advancedConfig);
      if (!validation.valid) {
        throw new AppError(
          400,
          'INVALID_ADVANCED_CONFIG',
          `Advanced config is invalid: ${validation.errors.join(', ')}`
        );
      }
    }

    // 1. Insert into DB
    const [host] = await this.db
      .insert(proxyHosts)
      .values({
        type: input.type,
        nodeId: input.nodeId,
        domainNames: input.domainNames,
        forwardHost: input.forwardHost ?? null,
        forwardPort: input.forwardPort ?? null,
        forwardScheme: input.forwardScheme,
        sslEnabled: input.sslEnabled,
        sslForced: input.sslForced,
        http2Support: input.http2Support,
        websocketSupport: input.websocketSupport,
        sslCertificateId: input.sslCertificateId ?? null,
        internalCertificateId: input.internalCertificateId ?? null,
        redirectUrl: input.redirectUrl ?? null,
        redirectStatusCode: input.redirectStatusCode ?? 301,
        customHeaders: input.customHeaders,
        cacheEnabled: input.cacheEnabled,
        cacheOptions: input.cacheOptions ?? null,
        rateLimitEnabled: input.rateLimitEnabled,
        rateLimitOptions: input.rateLimitOptions ?? null,
        customRewrites: input.customRewrites,
        advancedConfig: input.advancedConfig ?? null,
        rawConfig: (input as any).rawConfig ?? null,
        rawConfigEnabled: (input as any).rawConfigEnabled ?? false,
        accessListId: input.accessListId ?? null,
        folderId: input.folderId ?? null,
        nginxTemplateId: input.nginxTemplateId ?? null,
        templateVariables: input.templateVariables ?? {},
        healthCheckEnabled: input.healthCheckEnabled,
        healthCheckUrl: input.healthCheckUrl ?? '/',
        healthCheckInterval: input.healthCheckInterval ?? 30,
        healthCheckExpectedStatus: input.healthCheckExpectedStatus ?? null,
        healthCheckExpectedBody: input.healthCheckExpectedBody ?? null,
        healthCheckBodyMatchMode: input.healthCheckBodyMatchMode ?? 'includes',
        healthStatus: input.healthCheckEnabled ? 'unknown' : 'disabled',
        createdById: userId,
      })
      .returning();

    // 2. Resolve SSL cert paths and build nginx config
    try {
      const certPaths = await this.resolveCertPaths(host);
      const accessList = await this.resolveAccessList(host.accessListId);
      const config = await this.buildNginxConfig(host, certPaths, accessList);

      // 3. Apply config via daemon or legacy docker
      await this.applyConfigToNode(host.id, config, host.nodeId);
    } catch (error) {
      // 4. If nginx fails, delete the DB row and throw
      logger.error('Failed to apply nginx config for new proxy host, rolling back DB insert', {
        hostId: host.id,
        error,
      });
      await this.db.delete(proxyHosts).where(eq(proxyHosts.id, host.id));
      throw new AppError(
        500,
        'NGINX_CONFIG_FAILED',
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }

    // 5. Audit log
    await this.auditService.log({
      userId,
      action: 'proxy_host.create',
      resourceType: 'proxy_host',
      resourceId: host.id,
      details: { type: host.type, domainNames: host.domainNames },
    });

    logger.info('Created proxy host', { hostId: host.id, domains: host.domainNames });
    this.emitHost(host.id, 'created', host.domainNames?.[0]);

    // 6. Fire-and-forget immediate health check
    if (host.healthCheckEnabled) {
      this.runImmediateHealthCheck(host.id);
    }

    // 7. Return created host
    return host;
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  async updateProxyHost(id: string, input: UpdateProxyHostInput, userId: string) {
    // 0. Validate advanced config if provided
    if (input.advancedConfig) {
      const validation = this.configGenerator.validateAdvancedConfig(input.advancedConfig);
      if (!validation.valid) {
        throw new AppError(
          400,
          'INVALID_ADVANCED_CONFIG',
          `Advanced config is invalid: ${validation.errors.join(', ')}`
        );
      }
    }

    // 1. Get existing host
    const existing = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!existing) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');

    // 2. Update DB
    const updateData: Record<string, unknown> = {
      ...input,
      updatedAt: new Date(),
    };

    // Update healthStatus when healthCheckEnabled changes
    if (input.healthCheckEnabled !== undefined) {
      if (!input.healthCheckEnabled) {
        updateData.healthStatus = 'disabled';
      } else if (!existing.healthCheckEnabled) {
        // Was disabled, now enabled — set to unknown until first check
        updateData.healthStatus = 'unknown';
      }
    }

    const [updated] = await this.db.update(proxyHosts).set(updateData).where(eq(proxyHosts.id, id)).returning();

    // 3. Regenerate nginx config
    try {
      const certPaths = await this.resolveCertPaths(updated);
      const accessList = await this.resolveAccessList(updated.accessListId);
      const config = await this.buildNginxConfig(updated, certPaths, accessList);

      if (updated.enabled) {
        // 4. Apply config with rollback on failure
        await this.applyConfigToNode(id, config, updated.nodeId);
      } else {
        // If disabled, remove config and reload
        await this.removeConfigFromNode(id, updated.nodeId);
      }
    } catch (error) {
      // Rollback DB to previous state — only restore fields that were in the input
      logger.error('Failed to apply nginx config during update, rolling back DB', {
        hostId: id,
        error,
      });
      const rollbackData: Record<string, unknown> = {};
      for (const key of Object.keys(input)) {
        rollbackData[key] = (existing as Record<string, unknown>)[key];
      }
      rollbackData.updatedAt = existing.updatedAt;
      try {
        await this.db.update(proxyHosts).set(rollbackData).where(eq(proxyHosts.id, id));
      } catch (rollbackError) {
        logger.error('Failed to rollback DB after nginx config failure', {
          hostId: id,
          rollbackError,
        });
      }
      throw new AppError(
        500,
        'NGINX_CONFIG_FAILED',
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }

    // 5. Audit log
    await this.auditService.log({
      userId,
      action: 'proxy_host.update',
      resourceType: 'proxy_host',
      resourceId: id,
      details: { changes: Object.keys(input) },
    });

    logger.info('Updated proxy host', { hostId: id });
    this.emitHost(id, 'updated');

    // Fire immediate health check if healthcheck was just enabled
    if (input.healthCheckEnabled && !existing.healthCheckEnabled && updated.enabled) {
      this.runImmediateHealthCheck(id);
    }

    return updated;
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  async deleteProxyHost(id: string, userId: string) {
    // 1. Get existing host
    const existing = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!existing) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');
    if (existing.isSystem) throw new AppError(403, 'SYSTEM_HOST', 'System proxy hosts cannot be deleted');

    // 2. Delete from DB first (safer — lingering config is less harmful than zombie DB record)
    await this.db.delete(proxyHosts).where(eq(proxyHosts.id, id));

    // 3. Remove nginx config and reload (non-fatal if it fails after DB delete)
    try {
      await this.removeConfigFromNode(id, existing.nodeId);
    } catch (err) {
      logger.warn('Failed to remove nginx config after DB delete', { hostId: id, error: (err as Error).message });
    }

    // 5. Audit log
    await this.auditService.log({
      userId,
      action: 'proxy_host.delete',
      resourceType: 'proxy_host',
      resourceId: id,
      details: { domainNames: existing.domainNames },
    });

    logger.info('Deleted proxy host', { hostId: id, domains: existing.domainNames });
    this.emitHost(id, 'deleted', existing.domainNames?.[0]);
  }

  // -----------------------------------------------------------------------
  // Get single
  // -----------------------------------------------------------------------

  async getProxyHost(id: string) {
    const host = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!host) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');

    // Resolve relations
    const sslCert = host.sslCertificateId
      ? await this.db.query.sslCertificates.findFirst({
          where: eq(sslCertificates.id, host.sslCertificateId),
        })
      : null;

    const internalCert = host.internalCertificateId
      ? await this.db.query.certificates.findFirst({
          where: eq(certificates.id, host.internalCertificateId),
        })
      : null;

    const accessList = host.accessListId
      ? await this.db.query.accessLists.findFirst({
          where: eq(accessLists.id, host.accessListId),
        })
      : null;

    return {
      ...host,
      sslCertificate: sslCert
        ? {
            id: sslCert.id,
            name: sslCert.name,
            type: sslCert.type,
            domainNames: sslCert.domainNames,
            status: sslCert.status,
            notAfter: sslCert.notAfter,
          }
        : null,
      internalCertificate: internalCert
        ? {
            id: internalCert.id,
            commonName: internalCert.commonName,
            status: internalCert.status,
            notAfter: internalCert.notAfter,
          }
        : null,
      accessList: accessList
        ? {
            id: accessList.id,
            name: accessList.name,
          }
        : null,
    };
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  async listProxyHosts(query: ProxyHostListQuery): Promise<PaginatedResponse<ProxyHostRow>> {
    const conditions = [];

    if (query.type) {
      conditions.push(eq(proxyHosts.type, query.type));
    }
    if (query.enabled !== undefined) {
      conditions.push(eq(proxyHosts.enabled, query.enabled));
    }
    if (query.healthStatus) {
      conditions.push(eq(proxyHosts.healthStatus, query.healthStatus));
    }
    if (query.search) {
      // Search across domain names (cast jsonb to text for ilike)
      conditions.push(ilike(sql`${proxyHosts.domainNames}::text`, `%${escapeLike(query.search)}%`));
    }
    if (query.nodeId) {
      conditions.push(eq(proxyHosts.nodeId, query.nodeId));
    }

    const where = buildWhere(conditions);

    const [entries, [{ count: totalCount }]] = await Promise.all([
      this.db.query.proxyHosts.findMany({
        where: where ? () => where : undefined,
        orderBy: [desc(proxyHosts.createdAt)],
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      }),
      this.db.select({ count: count() }).from(proxyHosts).where(where),
    ]);

    const total = Number(totalCount);

    return {
      data: entries.map(({ healthHistory, rawConfig: _rc, ...rest }) => {
        let effectiveStatus = rest.healthStatus as string;
        if (rest.healthStatus === 'online' && Array.isArray(healthHistory) && healthHistory.length > 0) {
          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          const recent = (healthHistory as Array<{ ts?: string; status: string }>).filter((h) => {
            if (!h.ts) return false;
            return new Date(h.ts).getTime() >= fiveMinAgo;
          });
          if (recent.some((h) => h.status === 'offline' || h.status === 'degraded')) {
            effectiveStatus = 'recovering';
          }
        }
        return { ...rest, effectiveHealthStatus: effectiveStatus };
      }) as any,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  // -----------------------------------------------------------------------
  // Toggle enabled/disabled
  // -----------------------------------------------------------------------

  async toggleProxyHost(id: string, enabled: boolean, userId: string) {
    const existing = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!existing) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');
    if (existing.isSystem) throw new AppError(403, 'SYSTEM_HOST', 'System proxy hosts cannot be toggled');

    const previousEnabled = existing.enabled;

    const [updated] = await this.db
      .update(proxyHosts)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(proxyHosts.id, id))
      .returning();

    try {
      if (enabled) {
        // Re-enable: generate config and apply
        const certPaths = await this.resolveCertPaths(updated);
        const accessList = await this.resolveAccessList(updated.accessListId);
        const config = await this.buildNginxConfig(updated, certPaths, accessList);
        await this.applyConfigToNode(id, config, updated.nodeId);
      } else {
        // Disable: remove config and reload
        await this.removeConfigFromNode(id, updated.nodeId);
      }
    } catch (error) {
      // Rollback DB to previous enabled state
      logger.error('Failed to apply nginx config during toggle, rolling back DB', {
        hostId: id,
        error,
      });
      await this.db
        .update(proxyHosts)
        .set({ enabled: previousEnabled, updatedAt: existing.updatedAt })
        .where(eq(proxyHosts.id, id));
      throw new AppError(
        500,
        'NGINX_CONFIG_FAILED',
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }

    await this.auditService.log({
      userId,
      action: enabled ? 'proxy_host.enable' : 'proxy_host.disable',
      resourceType: 'proxy_host',
      resourceId: id,
    });

    logger.info('Toggled proxy host', { hostId: id, enabled });
    this.emitHost(id, 'updated', existing.domainNames?.[0]);

    // Fire-and-forget immediate health check when enabling
    if (enabled && updated.healthCheckEnabled) {
      this.runImmediateHealthCheck(id);
    }

    return updated;
  }

  // -----------------------------------------------------------------------
  // Immediate single-host health check (fire-and-forget)
  // -----------------------------------------------------------------------

  private runImmediateHealthCheck(hostId: string): void {
    // Run after a short delay to allow nginx reload to complete
    setTimeout(async () => {
      try {
        const host = await this.db.query.proxyHosts.findFirst({
          where: eq(proxyHosts.id, hostId),
        });
        if (!host?.healthCheckEnabled || !host.forwardHost || !host.forwardPort) return;

        const scheme = host.forwardScheme || 'http';
        const path = host.healthCheckUrl || '/';
        const url = `${scheme}://${host.forwardHost}:${host.forwardPort}${path}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        let status: 'online' | 'offline' | 'degraded' = 'offline';
        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow',
          });
          clearTimeout(timeout);

          const expectedStatus = (host as any).healthCheckExpectedStatus as number | null;
          if (expectedStatus) {
            status = response.status === expectedStatus ? 'online' : 'offline';
          } else {
            if (response.status >= 200 && response.status < 300) status = 'online';
            else if (response.status >= 500) status = 'offline';
            else status = 'degraded';
          }

          // Check expected body if configured
          const expectedBody = (host as any).healthCheckExpectedBody as string | null;
          const bodyMatchMode =
            ((host as any).healthCheckBodyMatchMode as HealthCheckBodyMatchMode | null) ?? 'includes';
          if (expectedBody && status === 'online') {
            const body = await response.text();
            if (!matchesExpectedBody(body, expectedBody, bodyMatchMode)) status = 'degraded';
          }
        } catch {
          clearTimeout(timeout);
          status = 'offline';
        }

        await this.db
          .update(proxyHosts)
          .set({ healthStatus: status, lastHealthCheckAt: new Date() })
          .where(eq(proxyHosts.id, hostId));

        logger.debug('Immediate health check complete', { hostId, status });
      } catch (err) {
        logger.debug('Immediate health check failed', { hostId, error: err });
      }
    }, 2000);
  }

  // -----------------------------------------------------------------------
  // Resync all hosts on a node (used on reconnect with hash mismatch)
  // -----------------------------------------------------------------------

  async resyncAllHostsOnNode(nodeId: string): Promise<void> {
    // Only resync enabled hosts explicitly assigned to this node
    const hosts = await this.db.query.proxyHosts.findMany({
      where: and(eq(proxyHosts.nodeId, nodeId), eq(proxyHosts.enabled, true)),
    });

    if (hosts.length === 0) {
      logger.info('No enabled hosts to resync for node', { nodeId });
      return;
    }

    logger.info('Resyncing all hosts on node', { nodeId, hostCount: hosts.length });

    for (const host of hosts) {
      try {
        const certPaths = await this.resolveCertPaths(host);
        const accessList = await this.resolveAccessList(host.accessListId);
        const config = await this.buildNginxConfig(host, certPaths, accessList);
        await this.applyConfigToNode(host.id, config, host.nodeId ?? nodeId);
      } catch (err) {
        logger.error('Failed to resync host config', { hostId: host.id, nodeId, error: (err as Error).message });
      }
    }

    logger.info('Node resync complete', { nodeId, hostCount: hosts.length });
  }

  // -----------------------------------------------------------------------
  // Get rendered nginx config for a host
  // -----------------------------------------------------------------------

  async getRenderedConfig(id: string): Promise<string> {
    const host = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!host) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');

    const certPaths = await this.resolveCertPaths(host);
    const accessList = await this.resolveAccessList(host.accessListId);
    return this.buildNginxConfig(host, certPaths, accessList);
  }

  // -----------------------------------------------------------------------
  // Validate advanced config snippet
  // -----------------------------------------------------------------------

  async validateAdvancedConfig(snippet: string, rawMode = false) {
    // Basic static checks first
    const staticResult = this.configGenerator.validateAdvancedConfig(snippet, rawMode);
    if (!staticResult.valid) return staticResult;

    // For raw mode, also run nginx -t syntax validation if available
    if (rawMode) {
      const syntaxResult = await this.nginxSyntaxValidator.validate(snippet);
      if (!syntaxResult.valid) return syntaxResult;
    }

    return staticResult;
  }

  // -----------------------------------------------------------------------
  // Helpers — cert path resolution
  // -----------------------------------------------------------------------

  private async resolveCertPaths(host: ProxyHostRow): Promise<CertPaths> {
    const empty: CertPaths = { sslCertPath: null, sslKeyPath: null, sslChainPath: null };

    if (!host.sslEnabled) return empty;

    // SSL certificate from the ssl_certificates table (ACME / upload)
    if (host.sslCertificateId) {
      const sslCert = await this.db.query.sslCertificates.findFirst({
        where: eq(sslCertificates.id, host.sslCertificateId),
      });

      if (sslCert?.certificatePem && sslCert.privateKeyPem) {
        // Decrypt the private key
        let keyPem: string;
        if (sslCert.encryptedDek) {
          keyPem = this.cryptoService.decryptPrivateKey({
            encryptedPrivateKey: sslCert.privateKeyPem,
            encryptedDek: sslCert.encryptedDek,
            dekIv: sslCert.dekIv || '',
          });
        } else {
          keyPem = sslCert.privateKeyPem;
        }

        if (!keyPem.includes('-----BEGIN')) {
          logger.error('SSL key decryption produced invalid PEM', {
            certId: sslCert.id,
            starts: keyPem.substring(0, 20),
          });
          throw new Error('Failed to decrypt SSL certificate private key');
        }

        // Deploy cert to the node via daemon
        const resolvedNodeId = await this.nodeDispatch.resolveNodeId(host.nodeId);
        await this.nodeDispatch.deployCertificate(
          resolvedNodeId,
          sslCert.id,
          Buffer.from(sslCert.certificatePem),
          Buffer.from(keyPem),
          sslCert.chainPem ? Buffer.from(sslCert.chainPem) : undefined
        );

        await this.auditService.log({
          userId: null,
          action: 'node.cert_deploy',
          resourceType: 'ssl_certificate',
          resourceId: sslCert.id,
          details: { nodeId: resolvedNodeId },
        });

        const paths = this.configGenerator.getCertPaths(sslCert.id);
        return {
          sslCertPath: paths.certPath,
          sslKeyPath: paths.keyPath,
          sslChainPath: sslCert.chainPem ? paths.chainPath : null,
        };
      }
    }

    // Internal certificate from PKI certificates table
    if (host.internalCertificateId) {
      const cert = await this.db.query.certificates.findFirst({
        where: eq(certificates.id, host.internalCertificateId),
      });

      if (cert?.certificatePem && cert.encryptedPrivateKey && cert.encryptedDek && cert.dekIv) {
        const keyPem = this.cryptoService.decryptPrivateKey({
          encryptedPrivateKey: cert.encryptedPrivateKey,
          encryptedDek: cert.encryptedDek,
          dekIv: cert.dekIv,
        });

        const certId = `internal-${cert.id}`;
        const resolvedNodeId = await this.nodeDispatch.resolveNodeId(host.nodeId);
        await this.nodeDispatch.deployCertificate(
          resolvedNodeId,
          certId,
          Buffer.from(cert.certificatePem),
          Buffer.from(keyPem)
        );

        await this.auditService.log({
          userId: null,
          action: 'node.cert_deploy',
          resourceType: 'certificate',
          resourceId: cert.id,
          details: { nodeId: resolvedNodeId, internal: true },
        });

        const paths = this.configGenerator.getCertPaths(certId);
        return {
          sslCertPath: paths.certPath,
          sslKeyPath: paths.keyPath,
          sslChainPath: null,
        };
      }
    }

    return empty;
  }

  // -----------------------------------------------------------------------
  // Helpers — access list resolution
  // -----------------------------------------------------------------------

  private async resolveAccessList(accessListId: string | null): Promise<ProxyHostConfig['accessList']> {
    if (!accessListId) return null;

    const list = await this.db.query.accessLists.findFirst({
      where: eq(accessLists.id, accessListId),
    });

    if (!list) return null;

    return {
      id: list.id,
      ipRules: list.ipRules as { type: string; value: string }[],
      basicAuthEnabled: list.basicAuthEnabled,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers — build ProxyHostConfig from DB row
  // -----------------------------------------------------------------------

  private async buildNginxConfig(
    host: ProxyHostRow,
    certPaths: CertPaths,
    accessList: ProxyHostConfig['accessList']
  ): Promise<string> {
    // Raw config mode — bypass template rendering entirely
    if ((host as any).rawConfigEnabled && (host as any).rawConfig) {
      return (host as any).rawConfig as string;
    }

    const config: ProxyHostConfig = {
      id: host.id,
      type: host.type,
      domainNames: host.domainNames,
      enabled: host.enabled,
      forwardHost: host.forwardHost,
      forwardPort: host.forwardPort,
      forwardScheme: host.forwardScheme ?? 'http',
      sslEnabled: host.sslEnabled,
      sslForced: host.sslForced,
      http2Support: host.http2Support,
      websocketSupport: host.websocketSupport,
      redirectUrl: host.redirectUrl,
      redirectStatusCode: host.redirectStatusCode ?? 301,
      customHeaders: (host.customHeaders ?? []) as { name: string; value: string }[],
      cacheEnabled: host.cacheEnabled,
      cacheOptions: host.cacheOptions as Record<string, unknown> | null,
      rateLimitEnabled: host.rateLimitEnabled,
      rateLimitOptions: host.rateLimitOptions as Record<string, unknown> | null,
      customRewrites: (host.customRewrites ?? []) as { source: string; destination: string; type: string }[],
      advancedConfig: host.advancedConfig,
      accessList,
      sslCertPath: certPaths.sslCertPath,
      sslKeyPath: certPaths.sslKeyPath,
      sslChainPath: certPaths.sslChainPath,
      templateVariables: (host.templateVariables ?? {}) as Record<string, string | number | boolean>,
    };

    return this.nginxTemplateService.renderForHost(config, host.nginxTemplateId ?? null);
  }
}
