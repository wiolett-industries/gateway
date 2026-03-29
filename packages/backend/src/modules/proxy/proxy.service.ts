import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { accessLists } from '@/db/schema/access-lists.js';
import { certificates } from '@/db/schema/certificates.js';
import { proxyHosts } from '@/db/schema/index.js';
import { sslCertificates } from '@/db/schema/ssl-certificates.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { NginxService, ProxyHostConfig } from '@/services/nginx.service.js';
import type { PaginatedResponse } from '@/types.js';
import type { NginxTemplateService } from './nginx-template.service.js';
import type { CreateProxyHostInput, ProxyHostListQuery, UpdateProxyHostInput } from './proxy.schemas.js';

const logger = createChildLogger('ProxyService');

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
    private readonly nginxService: NginxService,
    private readonly nginxTemplateService: NginxTemplateService,
    private readonly auditService: AuditService,
    private readonly cryptoService: CryptoService
  ) {}

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  async createProxyHost(input: CreateProxyHostInput, userId: string) {
    // 0. Validate advanced config if provided
    if (input.advancedConfig) {
      const validation = this.nginxService.validateAdvancedConfig(input.advancedConfig);
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
        accessListId: input.accessListId ?? null,
        folderId: input.folderId ?? null,
        nginxTemplateId: input.nginxTemplateId ?? null,
        templateVariables: input.templateVariables ?? {},
        healthCheckEnabled: input.healthCheckEnabled,
        healthCheckUrl: input.healthCheckUrl ?? '/',
        healthCheckInterval: input.healthCheckInterval ?? 30,
        healthCheckExpectedStatus: input.healthCheckExpectedStatus ?? null,
        healthCheckExpectedBody: input.healthCheckExpectedBody ?? null,
        healthStatus: input.healthCheckEnabled ? 'unknown' : 'disabled',
        createdById: userId,
      })
      .returning();

    // 2. Resolve SSL cert paths and build nginx config
    try {
      const certPaths = await this.resolveCertPaths(host);
      const accessList = await this.resolveAccessList(host.accessListId);
      const config = await this.buildNginxConfig(host, certPaths, accessList);

      // 3. Apply config (writes file, tests, reloads or rolls back)
      await this.nginxService.applyConfig(host.id, config);
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
      const validation = this.nginxService.validateAdvancedConfig(input.advancedConfig);
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

    const [updated] = await this.db
      .update(proxyHosts)
      .set(updateData)
      .where(eq(proxyHosts.id, id))
      .returning();

    // 3. Regenerate nginx config
    try {
      const certPaths = await this.resolveCertPaths(updated);
      const accessList = await this.resolveAccessList(updated.accessListId);
      const config = await this.buildNginxConfig(updated, certPaths, accessList);

      if (updated.enabled) {
        // 4. Apply config with rollback on failure
        await this.nginxService.applyConfig(id, config);
      } else {
        // If disabled, remove config and reload
        await this.nginxService.removeConfig(id);
        const testResult = await this.nginxService.testConfig();
        if (testResult.valid) {
          await this.nginxService.reloadNginx();
        }
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

    // 2. Remove nginx config
    await this.nginxService.removeConfig(id);

    // 3. Reload nginx
    const testResult = await this.nginxService.testConfig();
    if (testResult.valid) {
      await this.nginxService.reloadNginx();
    }

    // 4. Delete from DB
    await this.db.delete(proxyHosts).where(eq(proxyHosts.id, id));

    // 5. Audit log
    await this.auditService.log({
      userId,
      action: 'proxy_host.delete',
      resourceType: 'proxy_host',
      resourceId: id,
      details: { domainNames: existing.domainNames },
    });

    logger.info('Deleted proxy host', { hostId: id, domains: existing.domainNames });
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
      conditions.push(ilike(sql`${proxyHosts.domainNames}::text`, `%${query.search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

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
      data: entries,
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
        await this.nginxService.applyConfig(id, config);
      } else {
        // Disable: remove config and reload
        await this.nginxService.removeConfig(id);
        const testResult = await this.nginxService.testConfig();
        if (testResult.valid) {
          await this.nginxService.reloadNginx();
        }
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
        if (!host || !host.healthCheckEnabled || !host.forwardHost || !host.forwardPort) return;

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
          if (expectedBody && status === 'online') {
            const body = await response.text();
            if (!body.includes(expectedBody)) status = 'degraded';
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

  async validateAdvancedConfig(snippet: string) {
    return this.nginxService.validateAdvancedConfig(snippet);
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
          logger.error('SSL key decryption produced invalid PEM', { certId: sslCert.id, starts: keyPem.substring(0, 20) });
          throw new Error('Failed to decrypt SSL certificate private key');
        }

        const paths = await this.nginxService.deployCertificate(
          sslCert.id,
          sslCert.certificatePem,
          keyPem,
          sslCert.chainPem ?? undefined
        );

        return {
          sslCertPath: paths.certPath,
          sslKeyPath: paths.keyPath,
          sslChainPath: paths.chainPath ?? null,
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

        const paths = await this.nginxService.deployCertificate(`internal-${cert.id}`, cert.certificatePem, keyPem);

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
