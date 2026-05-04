import { describe, expect, it, vi } from 'vitest';
import { SetupTokenPolicyService } from './setup-token-policy.js';

function makeUserCountDb(realUserCount: number) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: realUserCount }]),
      })),
    })),
  } as any;
}

function makeService() {
  return new SetupTokenPolicyService({} as any) as any;
}

describe('SetupTokenPolicyService', () => {
  it('detects whether Gateway already has a real non-system user', async () => {
    await expect(new SetupTokenPolicyService(makeUserCountDb(0)).isGatewayConfigured()).resolves.toBe(false);
    await expect(new SetupTokenPolicyService(makeUserCountDb(1)).isGatewayConfigured()).resolves.toBe(true);
  });

  it('allows setup API during the first-start bootstrap window', async () => {
    const service = makeService();
    vi.spyOn(service, 'getTimestampSetting').mockImplementation(async (key: unknown) =>
      key === 'setup:started_at' ? new Date() : null
    );

    await expect(service.isSetupApiEnabled()).resolves.toBe(true);
  });

  it('disables setup API after setup is completed', async () => {
    const service = makeService();
    vi.spyOn(service, 'getTimestampSetting').mockImplementation(async (key: unknown) =>
      key === 'setup:completed_at' ? new Date() : null
    );

    await expect(service.isSetupApiEnabled()).resolves.toBe(false);
  });

  it('disables setup API one hour after first start', async () => {
    const service = makeService();
    const expired = new Date(Date.now() - 61 * 60 * 1000);
    vi.spyOn(service, 'getTimestampSetting').mockImplementation(async (key: unknown) =>
      key === 'setup:started_at' ? expired : null
    );

    await expect(service.isSetupApiEnabled()).resolves.toBe(false);
  });

  it('records setup start for fresh installer-created setup windows', async () => {
    const service = new SetupTokenPolicyService({} as any, true) as any;
    vi.spyOn(service, 'getTimestampSetting').mockResolvedValue(null);
    vi.spyOn(service, 'isGatewayConfigured').mockResolvedValue(false);
    const upsert = vi.spyOn(service, 'upsertSetting').mockResolvedValue(undefined);

    await service.ensureSetupStarted();

    expect(upsert).toHaveBeenCalledWith('setup:started_at', expect.any(String));
  });

  it('marks configured installs complete instead of honoring a new installer bootstrap flag', async () => {
    const service = new SetupTokenPolicyService({} as any, true) as any;
    vi.spyOn(service, 'getTimestampSetting').mockResolvedValue(null);
    vi.spyOn(service, 'isGatewayConfigured').mockResolvedValue(true);
    const markComplete = vi.spyOn(service, 'markSetupComplete').mockResolvedValue(undefined);
    const upsert = vi.spyOn(service, 'upsertSetting').mockResolvedValue(undefined);

    await service.ensureSetupStarted();

    expect(markComplete).toHaveBeenCalledOnce();
    expect(upsert).not.toHaveBeenCalledWith('setup:started_at', expect.any(String));
  });

  it('marks legacy installs without setup markers complete instead of reopening setup', async () => {
    const service = makeService();
    vi.spyOn(service, 'getTimestampSetting').mockResolvedValue(null);
    vi.spyOn(service, 'isGatewayConfigured').mockResolvedValue(false);
    const markComplete = vi.spyOn(service, 'markSetupComplete').mockResolvedValue(undefined);

    await service.ensureSetupStarted();

    expect(markComplete).toHaveBeenCalledOnce();
  });
});
