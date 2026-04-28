import { describe, expect, it, vi } from 'vitest';
import { McpSettingsService } from './mcp-settings.service.js';

function createDb(row: { value: unknown } | null = null) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

describe('McpSettingsService', () => {
  it('disables the MCP server by default', async () => {
    const service = new McpSettingsService(createDb() as any);

    await expect(service.isEnabled()).resolves.toBe(false);
  });

  it('reads a stored enabled setting', async () => {
    const service = new McpSettingsService(createDb({ value: true }) as any);

    await expect(service.isEnabled()).resolves.toBe(true);
  });
});
