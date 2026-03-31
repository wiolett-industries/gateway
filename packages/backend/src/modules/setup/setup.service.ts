import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { domains } from '@/db/schema/domains.js';
import { proxyHosts } from '@/db/schema/proxy-hosts.js';
import { sslCertificates } from '@/db/schema/ssl-certificates.js';
import { permissionGroups } from '@/db/schema/permission-groups.js';
import { users } from '@/db/schema/users.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DomainsService } from '@/modules/domains/domain.service.js';
import type { ProxyService } from '@/modules/proxy/proxy.service.js';
import type { SSLService } from '@/modules/ssl/ssl.service.js';

const logger = createChildLogger('SetupService');

export class SetupService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sslService: SSLService,
    private readonly proxyService: ProxyService,
    private readonly domainsService: DomainsService
  ) {}

  /**
   * Bootstrap management domain with ACME SSL.
   *
   * 1. Ensure a system user exists for ownership
   * 2. Create domain record (isSystem=true)
   * 3. Issue ACME cert (isSystem=true)
   * 4. Create proxy host pointing to app:3000 (isSystem=true)
   *
   * Idempotent — skips steps that are already done.
   */
  async bootstrapManagementSSL(domain: string, provider: 'letsencrypt' | 'letsencrypt-staging') {
    logger.info('Bootstrapping management SSL', { domain, provider });

    // 1. Get or create system user
    const systemUserId = await this.ensureSystemUser();

    // 2. Create domain record if not exists
    const existingDomain = await this.db
      .select()
      .from(domains)
      .where(eq(domains.domain, domain.toLowerCase()))
      .limit(1);

    let domainId: string;
    if (existingDomain.length > 0) {
      domainId = existingDomain[0].id;
      // Ensure it's marked as system
      if (!existingDomain[0].isSystem) {
        await this.db.update(domains).set({ isSystem: true, updatedAt: new Date() }).where(eq(domains.id, domainId));
      }
      logger.info('Domain already exists, reusing', { domainId });
    } else {
      const [row] = await this.db
        .insert(domains)
        .values({
          domain: domain.toLowerCase(),
          description: 'Management panel domain (auto-configured)',
          dnsStatus: 'pending',
          isSystem: true,
          createdById: systemUserId,
        })
        .returning();
      domainId = row.id;
      logger.info('Created system domain', { domainId });

      // Fire-and-forget DNS check
      this.domainsService.checkDns(domainId).catch(() => {});
    }

    // 3. Check if system cert already exists for this domain
    const existingCerts = await this.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.isSystem, true))
      .limit(1);

    let certId: string;
    if (existingCerts.length > 0 && existingCerts[0].status === 'active') {
      certId = existingCerts[0].id;
      logger.info('System cert already exists, reusing', { certId });
    } else {
      // Issue ACME cert
      const result = await this.sslService.requestACMECert(
        {
          domains: [domain],
          challengeType: 'http-01',
          provider,
          autoRenew: true,
        },
        systemUserId
      );

      certId = result.certificate.id;

      // Mark as system
      await this.db
        .update(sslCertificates)
        .set({ isSystem: true, updatedAt: new Date() })
        .where(eq(sslCertificates.id, certId));

      logger.info('ACME cert issued for management domain', { certId });
    }

    // 4. Check if system proxy host already exists
    const existingHost = await this.db.select().from(proxyHosts).where(eq(proxyHosts.isSystem, true)).limit(1);

    if (existingHost.length > 0) {
      logger.info('System proxy host already exists', { hostId: existingHost[0].id });
      return {
        domain,
        domainId,
        certId,
        proxyHostId: existingHost[0].id,
        status: 'already_configured',
      };
    }

    // Create management proxy host
    const host = await this.proxyService.createProxyHost(
      {
        type: 'proxy',
        domainNames: [domain],
        forwardHost: 'app',
        forwardPort: 3000,
        forwardScheme: 'http',
        sslEnabled: true,
        sslForced: true,
        http2Support: true,
        sslCertificateId: certId,
        websocketSupport: true,
        customHeaders: [],
        cacheEnabled: false,
        rateLimitEnabled: false,
        customRewrites: [],
        healthCheckEnabled: false,
      },
      systemUserId
    );

    // Mark as system
    await this.db.update(proxyHosts).set({ isSystem: true, updatedAt: new Date() }).where(eq(proxyHosts.id, host.id));

    logger.info('Management SSL bootstrap complete', { domain, certId, proxyHostId: host.id });

    return {
      domain,
      domainId,
      certId,
      proxyHostId: host.id,
      status: 'configured',
    };
  }

  /**
   * Bootstrap with a BYO (bring-your-own) certificate.
   * Same as bootstrapManagementSSL but uses uploaded cert instead of ACME.
   */
  async bootstrapManagementSSLUpload(domain: string, certificatePem: string, privateKeyPem: string, chainPem?: string) {
    logger.info('Bootstrapping management SSL with BYO cert', { domain });

    const systemUserId = await this.ensureSystemUser();

    // 1. Create domain record if not exists
    const existingDomain = await this.db
      .select()
      .from(domains)
      .where(eq(domains.domain, domain.toLowerCase()))
      .limit(1);

    let domainId: string;
    if (existingDomain.length > 0) {
      domainId = existingDomain[0].id;
      if (!existingDomain[0].isSystem) {
        await this.db.update(domains).set({ isSystem: true, updatedAt: new Date() }).where(eq(domains.id, domainId));
      }
    } else {
      const [row] = await this.db
        .insert(domains)
        .values({
          domain: domain.toLowerCase(),
          description: 'Management panel domain (auto-configured)',
          dnsStatus: 'pending',
          isSystem: true,
          createdById: systemUserId,
        })
        .returning();
      domainId = row.id;
      this.domainsService.checkDns(domainId).catch(() => {});
    }

    // 2. Upload cert
    const existingCerts = await this.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.isSystem, true))
      .limit(1);

    let certId: string;
    if (existingCerts.length > 0 && existingCerts[0].status === 'active') {
      certId = existingCerts[0].id;
      logger.info('System cert already exists, reusing', { certId });
    } else {
      const cert = await this.sslService.uploadCert(
        {
          name: `${domain} (management)`,
          certificatePem,
          privateKeyPem,
          chainPem,
        },
        systemUserId
      );
      certId = cert.id;
      await this.db
        .update(sslCertificates)
        .set({ isSystem: true, updatedAt: new Date() })
        .where(eq(sslCertificates.id, certId));
      logger.info('BYO cert uploaded for management domain', { certId });
    }

    // 3. Create proxy host
    const existingHost = await this.db.select().from(proxyHosts).where(eq(proxyHosts.isSystem, true)).limit(1);

    if (existingHost.length > 0) {
      return {
        domain,
        domainId,
        certId,
        proxyHostId: existingHost[0].id,
        status: 'already_configured',
      };
    }

    const host = await this.proxyService.createProxyHost(
      {
        type: 'proxy',
        domainNames: [domain],
        forwardHost: 'app',
        forwardPort: 3000,
        forwardScheme: 'http',
        sslEnabled: true,
        sslForced: true,
        http2Support: true,
        sslCertificateId: certId,
        websocketSupport: true,
        customHeaders: [],
        cacheEnabled: false,
        rateLimitEnabled: false,
        customRewrites: [],
        healthCheckEnabled: false,
      },
      systemUserId
    );

    await this.db.update(proxyHosts).set({ isSystem: true, updatedAt: new Date() }).where(eq(proxyHosts.id, host.id));

    logger.info('Management SSL (BYO) bootstrap complete', { domain, certId, proxyHostId: host.id });

    return {
      domain,
      domainId,
      certId,
      proxyHostId: host.id,
      status: 'configured',
    };
  }

  /**
   * Ensure a system user exists for owning bootstrap resources.
   * Uses a deterministic UUID so it's idempotent.
   */
  private async ensureSystemUser(): Promise<string> {
    const SYSTEM_OIDC_SUBJECT = 'system:gateway-setup';
    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.oidcSubject, SYSTEM_OIDC_SUBJECT))
      .limit(1);

    if (existing.length > 0) return existing[0].id;

    // Look up the system-admin group for the system user
    const adminGroup = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.name, 'system-admin'),
    });
    if (!adminGroup) throw new Error('system-admin group not found');

    const [user] = await this.db
      .insert(users)
      .values({
        oidcSubject: SYSTEM_OIDC_SUBJECT,
        email: 'system@gateway.local',
        name: 'Gateway System',
        groupId: adminGroup.id,
      })
      .returning({ id: users.id });

    logger.info('Created system user', { userId: user.id });
    return user.id;
  }
}
