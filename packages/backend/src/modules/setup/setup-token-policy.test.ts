import { describe, expect, it, vi } from 'vitest';
import { SetupTokenPolicyService } from './setup-token-policy.js';

function makeDb(realUserCount: number) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: realUserCount }]),
      })),
    })),
  } as any;
}

describe('SetupTokenPolicyService', () => {
  it('allows setup API before any real user exists', async () => {
    const service = new SetupTokenPolicyService(makeDb(0));

    await expect(service.isSetupApiEnabled()).resolves.toBe(true);
    await expect(service.isGatewayConfigured()).resolves.toBe(false);
  });

  it('disables setup API after a real non-system user exists', async () => {
    const service = new SetupTokenPolicyService(makeDb(1));

    await expect(service.isSetupApiEnabled()).resolves.toBe(false);
    await expect(service.isGatewayConfigured()).resolves.toBe(true);
  });
});
