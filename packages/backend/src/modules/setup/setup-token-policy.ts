import { count, eq, not } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings, users } from '@/db/schema/index.js';

const GATEWAY_SYSTEM_OIDC_SUBJECT = 'system:gateway-setup';
const SETUP_STARTED_AT_KEY = 'setup:started_at';
const SETUP_COMPLETED_AT_KEY = 'setup:completed_at';
const SETUP_TIMEOUT_MS = 60 * 60 * 1000;

export class SetupTokenPolicyService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly installerBootstrapEnabled = false
  ) {}

  async isGatewayConfigured(): Promise<boolean> {
    const [{ count: userCount }] = await this.db
      .select({ count: count() })
      .from(users)
      .where(not(eq(users.oidcSubject, GATEWAY_SYSTEM_OIDC_SUBJECT)));

    return Number(userCount) > 0;
  }

  async isSetupApiEnabled(): Promise<boolean> {
    const completedAt = await this.getTimestampSetting(SETUP_COMPLETED_AT_KEY);
    if (completedAt) return false;

    const startedAt = await this.getTimestampSetting(SETUP_STARTED_AT_KEY);
    if (!startedAt) return !(await this.isGatewayConfigured());

    return Date.now() - startedAt.getTime() < SETUP_TIMEOUT_MS;
  }

  async ensureSetupStarted(): Promise<void> {
    if (await this.getTimestampSetting(SETUP_COMPLETED_AT_KEY)) return;
    if (await this.getTimestampSetting(SETUP_STARTED_AT_KEY)) return;

    if (await this.isGatewayConfigured()) {
      await this.markSetupComplete();
      return;
    }

    if (this.installerBootstrapEnabled) {
      await this.upsertSetting(SETUP_STARTED_AT_KEY, new Date().toISOString());
      return;
    }

    await this.markSetupComplete();
  }

  async markSetupComplete(): Promise<void> {
    await this.upsertSetting(SETUP_COMPLETED_AT_KEY, new Date().toISOString());
  }

  private async getTimestampSetting(key: string): Promise<Date | null> {
    const [row] = await this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
    if (typeof row?.value !== 'string') return null;

    const timestamp = new Date(row.value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
