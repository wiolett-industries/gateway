import { describe, expect, it } from 'vitest';
import { UpdateAuthProvisioningSettingsSchema } from './admin.schemas.js';

describe('UpdateAuthProvisioningSettingsSchema', () => {
  it('accepts the MCP server toggle', () => {
    const result = UpdateAuthProvisioningSettingsSchema.safeParse({
      mcpServerEnabled: true,
    });

    expect(result.success).toBe(true);
  });
});
