import { count, desc, eq, ilike, sql } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { domains } from '@/db/schema/domains.js';
import { proxyHosts } from '@/db/schema/proxy-hosts.js';
import { sslCertificates } from '@/db/schema/ssl-certificates.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere } from '@/lib/utils.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { computeDnsStatus, resolveDnsRecords } from './dns.utils.js';
import type { CreateDomainInput, DomainListQuery, UpdateDomainInput } from './domain.schemas.js';

const logger = createChildLogger('DomainsService');

export interface DomainUsage {
  proxyHosts: Array<{ id: string; domainNames: string[]; enabled: boolean }>;
  sslCertificates: Array<{ id: string; domainNames: string[]; status: string; notAfter: Date | null }>;
}

export class DomainsService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly auditService: AuditService
  ) {}

  async listDomains(params: DomainListQuery) {
    const conditions = [];
    if (params.search) {
      conditions.push(ilike(domains.domain, `%${params.search}%`));
    }
    if (params.dnsStatus) {
      conditions.push(eq(domains.dnsStatus, params.dnsStatus));
    }
    const where = buildWhere(conditions);

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(domains)
        .where(where)
        .orderBy(desc(domains.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ total: count() }).from(domains).where(where),
    ]);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const usage = await this.getUsage(row.domain);
        return {
          ...row,
          sslCertCount: usage.sslCertificates.length,
          proxyHostCount: usage.proxyHosts.length,
        };
      })
    );

    return {
      data: enriched,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async getDomain(id: string) {
    const [row] = await this.db.select().from(domains).where(eq(domains.id, id)).limit(1);
    if (!row) throw new Error('Domain not found');
    const usage = await this.getUsage(row.domain);
    return { ...row, usage };
  }

  async createDomain(input: CreateDomainInput, userId: string) {
    const [row] = await this.db
      .insert(domains)
      .values({
        domain: input.domain.toLowerCase(),
        description: input.description,
        dnsStatus: 'pending',
        createdById: userId,
      })
      .returning();

    await this.auditService.log({
      userId,
      action: 'domain.create',
      resourceType: 'domain',
      resourceId: row.id,
      details: { domain: row.domain },
    });

    // Fire-and-forget DNS check
    this.checkDns(row.id).catch((err) => logger.warn('Initial DNS check failed', { id: row.id, error: err.message }));

    return row;
  }

  async updateDomain(id: string, input: UpdateDomainInput, userId: string) {
    const [row] = await this.db
      .update(domains)
      .set({ description: input.description, updatedAt: new Date() })
      .where(eq(domains.id, id))
      .returning();

    if (!row) throw new Error('Domain not found');

    await this.auditService.log({
      userId,
      action: 'domain.update',
      resourceType: 'domain',
      resourceId: id,
      details: { domain: row.domain },
    });

    return row;
  }

  async deleteDomain(id: string, userId: string) {
    const [row] = await this.db.select().from(domains).where(eq(domains.id, id)).limit(1);
    if (!row) throw new Error('Domain not found');
    if (row.isSystem) throw new Error('System domains cannot be deleted');

    const usage = await this.getUsage(row.domain);

    if (usage.proxyHosts.length > 0) {
      throw Object.assign(new Error('Domain is in use by proxy hosts'), {
        code: 'DOMAIN_IN_USE',
        details: {
          proxyHostCount: usage.proxyHosts.length,
          proxyHostIds: usage.proxyHosts.map((h) => h.id),
        },
      });
    }

    await this.db.delete(domains).where(eq(domains.id, id));

    await this.auditService.log({
      userId,
      action: 'domain.delete',
      resourceType: 'domain',
      resourceId: id,
      details: {
        domain: row.domain,
        usedByProxyHosts: usage.proxyHosts.length,
        usedBySslCerts: usage.sslCertificates.length,
      },
    });
  }

  async checkDns(id: string) {
    const [row] = await this.db.select().from(domains).where(eq(domains.id, id)).limit(1);
    if (!row) throw new Error('Domain not found');

    const dnsRecords = await resolveDnsRecords(row.domain);
    const dnsStatus = computeDnsStatus(dnsRecords);

    const [updated] = await this.db
      .update(domains)
      .set({ dnsStatus, dnsRecords, lastDnsCheckAt: new Date(), updatedAt: new Date() })
      .where(eq(domains.id, id))
      .returning();

    logger.debug('DNS check complete', { domain: row.domain, status: dnsStatus });
    return updated;
  }

  async checkAllDns() {
    const allDomains = await this.db.select({ id: domains.id, domain: domains.domain }).from(domains);
    if (allDomains.length === 0) return;

    logger.debug(`Running DNS checks for ${allDomains.length} domains`);

    const results = await Promise.allSettled(
      allDomains.map(async (d) => {
        const dnsRecords = await resolveDnsRecords(d.domain);
        const dnsStatus = computeDnsStatus(dnsRecords);
        await this.db
          .update(domains)
          .set({ dnsStatus, dnsRecords, lastDnsCheckAt: new Date(), updatedAt: new Date() })
          .where(eq(domains.id, d.id));
        return { domain: d.domain, status: dnsStatus };
      })
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    logger.info(`DNS check complete: ${succeeded} ok, ${failed} failed`);
  }

  async getUsage(domainName: string): Promise<DomainUsage> {
    const jsonContains = sql`${JSON.stringify([domainName])}::jsonb`;
    const wildcardContains = sql`${JSON.stringify([`*.${domainName}`])}::jsonb`;

    const [hosts, certs] = await Promise.all([
      this.db
        .select({
          id: proxyHosts.id,
          domainNames: proxyHosts.domainNames,
          enabled: proxyHosts.enabled,
        })
        .from(proxyHosts)
        .where(sql`${proxyHosts.domainNames} @> ${jsonContains} OR ${proxyHosts.domainNames} @> ${wildcardContains}`),
      this.db
        .select({
          id: sslCertificates.id,
          domainNames: sslCertificates.domainNames,
          status: sslCertificates.status,
          notAfter: sslCertificates.notAfter,
        })
        .from(sslCertificates)
        .where(sql`${sslCertificates.domainNames} @> ${jsonContains}`),
    ]);

    return { proxyHosts: hosts, sslCertificates: certs };
  }

  async searchDomains(query: string) {
    return this.db
      .select({ id: domains.id, domain: domains.domain, dnsStatus: domains.dnsStatus })
      .from(domains)
      .where(ilike(domains.domain, `%${query}%`))
      .orderBy(domains.domain)
      .limit(10);
  }
}
