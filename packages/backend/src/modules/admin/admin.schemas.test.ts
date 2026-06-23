import { describe, expect, it } from 'vitest';
import { UpdateAuthProvisioningSettingsSchema } from './admin.schemas.js';

describe('UpdateAuthProvisioningSettingsSchema', () => {
  it('accepts the MCP server toggle', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      mcpServerEnabled: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts auth provisioning compatibility toggles', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      oidcRequireVerifiedEmail: true,
      oauthExtendedCallbackCompatibility: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts general file upload limit settings', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      generalSettings: {
        fileUploadMaxBytes: 100 * 1024 * 1024,
        fileOpenMaxBytes: 10 * 1024 * 1024,
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts general feature visibility settings', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      generalSettings: {
        features: {
          pkiEnabled: false,
          domainsEnabled: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid general file upload limit settings', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      generalSettings: {
        fileUploadMaxBytes: 1024,
        fileOpenMaxBytes: 10 * 1024 * 1024,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid trusted proxy CIDRs', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      networkSecurity: {
        trustedProxyCidrs: ['not-a-cidr'],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid outbound webhook private CIDRs', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      outboundWebhookPolicy: {
        allowPrivateNetworks: true,
        allowedPrivateCidrs: ['not-a-cidr'],
      },
    });

    expect(result.success).toBe(false);
  });
});
