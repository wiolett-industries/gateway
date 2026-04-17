import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups, settings } from '@/db/schema/index.js';

const AUTH_SETTINGS_DEFAULTS = {
  'auth:oidc_auto_create_users': true,
} as const;

export interface AuthProvisioningSettings {
  oidcAutoCreateUsers: boolean;
  oidcDefaultGroupId: string;
}

export class AuthSettingsService {
  constructor(private readonly db: DrizzleClient) {}

  async getConfig(): Promise<AuthProvisioningSettings> {
    const autoCreateUsers = await this.getSetting<boolean>(
      'auth:oidc_auto_create_users',
      AUTH_SETTINGS_DEFAULTS['auth:oidc_auto_create_users']
    );

    const defaultGroupId = await this.resolveDefaultGroupId();

    return {
      oidcAutoCreateUsers: autoCreateUsers,
      oidcDefaultGroupId: defaultGroupId,
    };
  }

  async updateConfig(updates: {
    oidcAutoCreateUsers?: boolean;
    oidcDefaultGroupId?: string;
  }): Promise<AuthProvisioningSettings> {
    if (updates.oidcAutoCreateUsers !== undefined) {
      await this.setSetting('auth:oidc_auto_create_users', updates.oidcAutoCreateUsers);
    }

    if (updates.oidcDefaultGroupId !== undefined) {
      const group = await this.db.query.permissionGroups.findFirst({
        where: eq(permissionGroups.id, updates.oidcDefaultGroupId),
      });
      if (!group) {
        throw new Error('Permission group not found');
      }
      await this.setSetting('auth:oidc_default_group_id', group.id);
    }

    return this.getConfig();
  }

  async resolveDefaultGroupId(): Promise<string> {
    const stored = await this.getSetting<string | null>('auth:oidc_default_group_id', null);
    if (stored) {
      const existing = await this.db.query.permissionGroups.findFirst({
        where: eq(permissionGroups.id, stored),
      });
      if (existing) return existing.id;
    }

    const viewerGroup = await this.db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.name, 'viewer'),
    });
    if (!viewerGroup) {
      throw new Error('Built-in group "viewer" not found. Has the migration been run?');
    }

    await this.setSetting('auth:oidc_default_group_id', viewerGroup.id);
    return viewerGroup.id;
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
