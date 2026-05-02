import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups, settings } from '@/db/schema/index.js';

const AUTH_SETTINGS_DEFAULTS = {
  'auth:oidc_auto_create_users': true,
  'auth:oidc_require_verified_email': false,
  'auth:oauth_extended_callback_compatibility': false,
} as const;

export interface AuthProvisioningSettings {
  oidcAutoCreateUsers: boolean;
  oidcDefaultGroupId: string;
  oidcRequireVerifiedEmail: boolean;
  oauthExtendedCallbackCompatibility: boolean;
}

export class AuthSettingsService {
  constructor(private readonly db: DrizzleClient) {}

  async getConfig(): Promise<AuthProvisioningSettings> {
    const autoCreateUsers = await this.getSetting<boolean>(
      'auth:oidc_auto_create_users',
      AUTH_SETTINGS_DEFAULTS['auth:oidc_auto_create_users']
    );

    const defaultGroupId = await this.resolveDefaultGroupId();
    const requireVerifiedEmail = await this.getSetting<boolean>(
      'auth:oidc_require_verified_email',
      AUTH_SETTINGS_DEFAULTS['auth:oidc_require_verified_email']
    );
    const oauthExtendedCallbackCompatibility = await this.getSetting<boolean>(
      'auth:oauth_extended_callback_compatibility',
      AUTH_SETTINGS_DEFAULTS['auth:oauth_extended_callback_compatibility']
    );

    return {
      oidcAutoCreateUsers: autoCreateUsers,
      oidcDefaultGroupId: defaultGroupId,
      oidcRequireVerifiedEmail: requireVerifiedEmail,
      oauthExtendedCallbackCompatibility,
    };
  }

  async updateConfig(updates: {
    oidcAutoCreateUsers?: boolean;
    oidcDefaultGroupId?: string;
    oidcRequireVerifiedEmail?: boolean;
    oauthExtendedCallbackCompatibility?: boolean;
  }): Promise<AuthProvisioningSettings> {
    if (updates.oidcAutoCreateUsers !== undefined) {
      await this.setSetting('auth:oidc_auto_create_users', updates.oidcAutoCreateUsers);
    }

    if (updates.oidcRequireVerifiedEmail !== undefined) {
      await this.setSetting('auth:oidc_require_verified_email', updates.oidcRequireVerifiedEmail);
    }

    if (updates.oauthExtendedCallbackCompatibility !== undefined) {
      await this.setSetting('auth:oauth_extended_callback_compatibility', updates.oauthExtendedCallbackCompatibility);
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

  async getOAuthExtendedCallbackCompatibility(): Promise<boolean> {
    return this.getSetting<boolean>(
      'auth:oauth_extended_callback_compatibility',
      AUTH_SETTINGS_DEFAULTS['auth:oauth_extended_callback_compatibility']
    );
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
