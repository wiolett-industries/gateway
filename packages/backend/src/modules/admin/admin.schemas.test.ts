import { describe, expect, it } from 'vitest';
import { UpdateAuthProvisioningSettingsSchema } from './admin.schemas.js';

describe('UpdateAuthProvisioningSettingsSchema', () => {
  it('accepts the MCP server toggle', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      mcpServerEnabled: true,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid trusted proxy CIDRs', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      networkSecurity: {
        trustedProxyCidrs: ['not-a-cidr'],
      },
    });

    expect(result.success).toBe(false);
  });
});
