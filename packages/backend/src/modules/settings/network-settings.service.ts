import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/index.js';
import { isValidCidr } from '@/lib/ip-cidr.js';

export const CLIENT_IP_SOURCE_VALUES = ['auto', 'direct', 'reverse_proxy', 'cloudflare'] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCE_VALUES)[number];

export interface NetworkSecuritySettings {
  clientIpSource: ClientIpSource;
  trustedProxyCidrs: string[];
  trustCloudflareHeaders: boolean;
}

const SETTINGS_KEY = 'network:client_ip';

export const DEFAULT_NETWORK_SECURITY_SETTINGS: NetworkSecuritySettings = {
  clientIpSource: 'auto',
  trustedProxyCidrs: [],
  trustCloudflareHeaders: false,
};

export class NetworkSettingsService {
  private cached: NetworkSecuritySettings | null = null;
  private cachedAt = 0;

  constructor(private readonly db: DrizzleClient) {}

  async getConfig(): Promise<NetworkSecuritySettings> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < 5000) {
      return this.cached;
    }

    const [row] = await this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
    const config = this.normalize(row?.value);
    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(updates: Partial<NetworkSecuritySettings>): Promise<NetworkSecuritySettings> {
    const current = await this.getConfig();
    const next = this.normalize({ ...current, ...updates });
    const invalidCidr = next.trustedProxyCidrs.find((cidr) => !isValidCidr(cidr));
    if (invalidCidr) {
      throw new Error(`Invalid trusted proxy CIDR: ${invalidCidr}`);
    }
    await this.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: next, updatedAt: new Date() },
      });
    this.cached = next;
    this.cachedAt = Date.now();
    return next;
  }

  private normalize(value: unknown): NetworkSecuritySettings {
    const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const clientIpSource = CLIENT_IP_SOURCE_VALUES.includes(record.clientIpSource as ClientIpSource)
      ? (record.clientIpSource as ClientIpSource)
      : DEFAULT_NETWORK_SECURITY_SETTINGS.clientIpSource;
    const trustedProxyCidrs = Array.isArray(record.trustedProxyCidrs)
      ? record.trustedProxyCidrs
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : DEFAULT_NETWORK_SECURITY_SETTINGS.trustedProxyCidrs;

    return {
      clientIpSource,
      trustedProxyCidrs,
      trustCloudflareHeaders:
        typeof record.trustCloudflareHeaders === 'boolean' ? record.trustCloudflareHeaders : false,
    };
  }
}
