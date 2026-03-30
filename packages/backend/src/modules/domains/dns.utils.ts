import { Resolver } from 'node:dns/promises';
import type { DnsRecords } from '@/db/schema/domains.js';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('DnsUtils');

// Configured via initDnsResolver()
let resolver = new Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

export function initDnsResolver(servers: string[]): void {
  resolver = new Resolver();
  resolver.setServers(servers);
  logger.info(`DNS resolvers set to: ${servers.join(', ')}`);
}

const DNS_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)),
  ]);
}

let cachedPublicIPv4: string | null = null;
let cachedPublicIPv6: string | null = null;

export async function detectPublicIP(envIPv4?: string, envIPv6?: string): Promise<void> {
  cachedPublicIPv4 = envIPv4 || null;
  cachedPublicIPv6 = envIPv6 || null;

  if (!cachedPublicIPv4) {
    try {
      const resp = await fetch('https://api.ipify.org?format=text');
      cachedPublicIPv4 = (await resp.text()).trim();
      logger.info(`Detected public IPv4: ${cachedPublicIPv4}`);
    } catch {
      logger.warn('Failed to detect public IPv4');
    }
  }

  if (!cachedPublicIPv6) {
    try {
      const resp = await fetch('https://api64.ipify.org?format=text');
      const ip = (await resp.text()).trim();
      if (ip.includes(':')) {
        cachedPublicIPv6 = ip;
        logger.info(`Detected public IPv6: ${cachedPublicIPv6}`);
      }
    } catch {
      logger.warn('Failed to detect public IPv6');
    }
  }
}

export function getPublicIPs(): { ipv4: string | null; ipv6: string | null } {
  return { ipv4: cachedPublicIPv4, ipv6: cachedPublicIPv6 };
}

export async function resolveDnsRecords(domain: string): Promise<DnsRecords> {
  const [a, aaaa, cname, caa, mx, txt] = await Promise.allSettled([
    withTimeout(resolver.resolve4(domain)),
    withTimeout(resolver.resolve6(domain)),
    withTimeout(resolver.resolveCname(domain)),
    withTimeout(resolver.resolveCaa(domain)),
    withTimeout(resolver.resolveMx(domain)),
    withTimeout(resolver.resolveTxt(domain)),
  ]);

  return {
    a: a.status === 'fulfilled' ? a.value : [],
    aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [],
    cname: cname.status === 'fulfilled' ? cname.value : [],
    caa:
      caa.status === 'fulfilled'
        ? caa.value.map((r) => ({
            critical: r.critical,
            issue: r.issue,
            issuewild: r.issuewild,
          }))
        : [],
    mx: mx.status === 'fulfilled' ? mx.value : [],
    txt: txt.status === 'fulfilled' ? txt.value : [],
  };
}

export type DnsStatus = 'valid' | 'invalid' | 'pending' | 'unknown';

export function computeDnsStatus(records: DnsRecords): DnsStatus {
  const { ipv4, ipv6 } = getPublicIPs();
  const hasARecords = records.a.length > 0 || records.aaaa.length > 0;

  if (!hasARecords && records.cname.length === 0) {
    return 'unknown';
  }

  const ipv4Match = ipv4 ? records.a.includes(ipv4) : false;
  const ipv6Match = ipv6 ? records.aaaa.includes(ipv6) : false;

  if (ipv4Match || ipv6Match) {
    return 'valid';
  }

  if (hasARecords) {
    return 'invalid';
  }

  return 'unknown';
}
