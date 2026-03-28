import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { certificateAuthorities, certificates, proxyHosts, sslCertificates } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('MonitoringService');

export interface DashboardStats {
  proxyHosts: {
    total: number;
    enabled: number;
    online: number;
    offline: number;
    degraded: number;
  };
  sslCertificates: {
    total: number;
    active: number;
    expiringSoon: number;
    expired: number;
  };
  pkiCertificates: {
    total: number;
    active: number;
    revoked: number;
    expired: number;
  };
  cas: {
    total: number;
    active: number;
  };
}

export interface HealthOverviewEntry {
  id: string;
  domainNames: string[];
  type: string;
  enabled: boolean;
  healthStatus: string | null;
  lastHealthCheckAt: Date | null;
}

export class MonitoringService {
  constructor(private readonly db: DrizzleClient) {}

  async getDashboardStats(): Promise<DashboardStats> {
    logger.debug('Fetching dashboard stats');

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      // Proxy host counts
      proxyTotal,
      proxyEnabled,
      proxyOnline,
      proxyOffline,
      proxyDegraded,

      // SSL certificate counts
      sslTotal,
      sslActive,
      sslExpiringSoon,
      sslExpired,

      // PKI certificate counts
      pkiTotal,
      pkiActive,
      pkiRevoked,
      pkiExpired,

      // CA counts
      caTotal,
      caActive,
    ] = await Promise.all([
      // Proxy hosts
      this.db.select({ value: count() }).from(proxyHosts),
      this.db.select({ value: count() }).from(proxyHosts).where(eq(proxyHosts.enabled, true)),
      this.db.select({ value: count() }).from(proxyHosts).where(eq(proxyHosts.healthStatus, 'online')),
      this.db.select({ value: count() }).from(proxyHosts).where(eq(proxyHosts.healthStatus, 'offline')),
      this.db.select({ value: count() }).from(proxyHosts).where(eq(proxyHosts.healthStatus, 'degraded')),

      // SSL certificates
      this.db.select({ value: count() }).from(sslCertificates),
      this.db.select({ value: count() }).from(sslCertificates).where(eq(sslCertificates.status, 'active')),
      this.db
        .select({ value: count() })
        .from(sslCertificates)
        .where(
          and(
            eq(sslCertificates.status, 'active'),
            gt(sslCertificates.notAfter, now),
            lt(sslCertificates.notAfter, thirtyDaysFromNow)
          )
        ),
      this.db.select({ value: count() }).from(sslCertificates).where(eq(sslCertificates.status, 'expired')),

      // PKI certificates
      this.db.select({ value: count() }).from(certificates),
      this.db.select({ value: count() }).from(certificates).where(eq(certificates.status, 'active')),
      this.db.select({ value: count() }).from(certificates).where(eq(certificates.status, 'revoked')),
      this.db.select({ value: count() }).from(certificates).where(eq(certificates.status, 'expired')),

      // Certificate authorities
      this.db.select({ value: count() }).from(certificateAuthorities),
      this.db
        .select({ value: count() })
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.status, 'active')),
    ]);

    return {
      proxyHosts: {
        total: Number(proxyTotal[0].value),
        enabled: Number(proxyEnabled[0].value),
        online: Number(proxyOnline[0].value),
        offline: Number(proxyOffline[0].value),
        degraded: Number(proxyDegraded[0].value),
      },
      sslCertificates: {
        total: Number(sslTotal[0].value),
        active: Number(sslActive[0].value),
        expiringSoon: Number(sslExpiringSoon[0].value),
        expired: Number(sslExpired[0].value),
      },
      pkiCertificates: {
        total: Number(pkiTotal[0].value),
        active: Number(pkiActive[0].value),
        revoked: Number(pkiRevoked[0].value),
        expired: Number(pkiExpired[0].value),
      },
      cas: {
        total: Number(caTotal[0].value),
        active: Number(caActive[0].value),
      },
    };
  }

  async getHealthOverview(): Promise<HealthOverviewEntry[]> {
    logger.debug('Fetching health overview');

    const hosts = await this.db
      .select({
        id: proxyHosts.id,
        domainNames: proxyHosts.domainNames,
        type: proxyHosts.type,
        enabled: proxyHosts.enabled,
        healthStatus: proxyHosts.healthStatus,
        lastHealthCheckAt: proxyHosts.lastHealthCheckAt,
      })
      .from(proxyHosts)
      .orderBy(
        // Order: offline first, then degraded, then online, then unknown
        sql`CASE ${proxyHosts.healthStatus}
          WHEN 'offline' THEN 0
          WHEN 'degraded' THEN 1
          WHEN 'online' THEN 2
          WHEN 'unknown' THEN 3
          ELSE 4
        END`
      );

    return hosts;
  }
}
