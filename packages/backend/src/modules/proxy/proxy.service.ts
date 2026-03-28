import { eq, and, ilike, sql, count, desc } from 'drizzle-orm';
import { proxyHosts } from '@/db/schema/index.js';
import { sslCertificates } from '@/db/schema/ssl-certificates.js';
import { certificates } from '@/db/schema/certificates.js';
import { accessLists } from '@/db/schema/access-lists.js';
import { NginxService } from '@/services/nginx.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { AppError } from '@/middleware/error-handler.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';
import type { ProxyHostConfig } from '@/services/nginx.service.js';
import type { CreateProxyHostInput, UpdateProxyHostInput, ProxyHostListQuery } from './proxy.schemas.js';
import type { PaginatedResponse } from '@/types.js';

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
    private readonly auditService: AuditService,
    private readonly cryptoService: CryptoService,
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
          `Advanced config is invalid: ${validation.errors.join(', ')}`,
        );
      }
    }

    // 1. Insert into DB
    const [host] = await this.db.insert(proxyHosts).values({
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
      healthCheckEnabled: input.healthCheckEnabled,
      healthCheckUrl: input.healthCheckUrl ?? '/',
      healthCheckInterval: input.healthCheckInterval ?? 30,
      createdById: userId,
    }).returning();

    // 2. Resolve SSL cert paths and build nginx config
    try {
      const certPaths = await this.resolveCertPaths(host);
      const accessList = await this.resolveAccessList(host.accessListId);
      const config = this.buildNginxConfig(host, certPaths, accessList);

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
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`,
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

    // 6. Return created host
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
          `Advanced config is invalid: ${validation.errors.join(', ')}`,
        );
      }
    }

    // 1. Get existing host
    const existing = await this.db.query.proxyHosts.findFirst({
      where: eq(proxyHosts.id, id),
    });
    if (!existing) throw new AppError(404, 'PROXY_HOST_NOT_FOUND', 'Proxy host not found');

    // 2. Update DB
    const [updated] = await this.db
      .update(proxyHosts)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(proxyHosts.id, id))
      .returning();

    // 3. Regenerate nginx config
    try {
      const certPaths = await this.resolveCertPaths(updated);
      const accessList = await this.resolveAccessList(updated.accessListId);
      const config = this.buildNginxConfig(updated, certPaths, accessList);

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
        await this.db
          .update(proxyHosts)
          .set(rollbackData)
          .where(eq(proxyHosts.id, id));
      } catch (rollbackError) {
        logger.error('Failed to rollback DB after nginx config failure', {
          hostId: id,
          rollbackError,
        });
      }
      throw new AppError(
        500,
        'NGINX_CONFIG_FAILED',
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`,
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
      conditions.push(
        ilike(sql`${proxyHosts.domainNames}::text`, `%${query.search}%`),
      );
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
        const config = this.buildNginxConfig(updated, certPaths, accessList);
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
        `Failed to apply Nginx config: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    await this.auditService.log({
      userId,
      action: enabled ? 'proxy_host.enable' : 'proxy_host.disable',
      resourceType: 'proxy_host',
      resourceId: id,
    });

    logger.info('Toggled proxy host', { hostId: id, enabled });
    return updated;
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

      if (sslCert && sslCert.certificatePem && sslCert.privateKeyPem) {
        // Decrypt the private key
        let keyPem: string;
        if (sslCert.encryptedDek && sslCert.dekIv) {
          keyPem = this.cryptoService.decryptPrivateKey({
            encryptedPrivateKey: sslCert.privateKeyPem,
            encryptedDek: sslCert.encryptedDek,
            dekIv: sslCert.dekIv,
          });
        } else {
          keyPem = sslCert.privateKeyPem;
        }

        const paths = await this.nginxService.deployCertificate(
          sslCert.id,
          sslCert.certificatePem,
          keyPem,
          sslCert.chainPem ?? undefined,
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

      if (cert && cert.certificatePem && cert.encryptedPrivateKey && cert.encryptedDek && cert.dekIv) {
        const keyPem = this.cryptoService.decryptPrivateKey({
          encryptedPrivateKey: cert.encryptedPrivateKey,
          encryptedDek: cert.encryptedDek,
          dekIv: cert.dekIv,
        });

        const paths = await this.nginxService.deployCertificate(
          `internal-${cert.id}`,
          cert.certificatePem,
          keyPem,
        );

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

  private async resolveAccessList(
    accessListId: string | null,
  ): Promise<ProxyHostConfig['accessList']> {
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

  private buildNginxConfig(
    host: ProxyHostRow,
    certPaths: CertPaths,
    accessList: ProxyHostConfig['accessList'],
  ): string {
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
    };

    return this.nginxService.generateConfig(config);
  }
}
