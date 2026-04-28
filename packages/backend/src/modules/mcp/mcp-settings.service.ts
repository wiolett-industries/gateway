import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/settings.js';

const MCP_SETTINGS_DEFAULTS = {
  'mcp:server_enabled': false,
} as const;

export interface McpSettingsConfig {
  serverEnabled: boolean;
}

export class McpSettingsService {
  constructor(private readonly db: DrizzleClient) {}

  async getConfig(): Promise<McpSettingsConfig> {
    return {
      serverEnabled: await this.getSetting('mcp:server_enabled', MCP_SETTINGS_DEFAULTS['mcp:server_enabled']),
    };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getConfig()).serverEnabled;
  }

  async updateConfig(updates: { serverEnabled?: boolean }): Promise<McpSettingsConfig> {
    if (updates.serverEnabled !== undefined) {
      await this.setSetting('mcp:server_enabled', updates.serverEnabled);
    }

    return this.getConfig();
  }

  private async getSetting<T>(key: string, fallback: T): Promise<T> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return (row?.value !== undefined ? row.value : fallback) as T;
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
