import { describe, expect, it, vi } from 'vitest';
import { LicenseService } from './license.service.js';

function createDb() {
  const rows = new Map<string, unknown>();
  const keyFromCondition = (condition: unknown): string | undefined => {
    const chunks = (condition as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
    for (const chunk of chunks) {
      const value = (chunk as { value?: unknown }).value;
      if (typeof value === 'string' && value.startsWith('license:')) return value;
    }
    return undefined;
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: () => {
            const key = keyFromCondition(condition);
            return Promise.resolve(key && rows.has(key) ? [{ key, value: rows.get(key) }] : []);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: { key: string; value: unknown }) => ({
        onConflictDoUpdate: () => {
          rows.set(value.key, value.value);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: (condition: unknown) => {
        const key = keyFromCondition(condition);
        if (key) rows.delete(key);
        return Promise.resolve();
      },
    }),
    rows,
  };
  return db;
}

function createCrypto() {
  return {
    encryptString: (plaintext: string) => ({ encryptedKey: `enc:${plaintext}`, encryptedDek: 'dek' }),
    decryptString: (encrypted: { encryptedKey: string }) => encrypted.encryptedKey.replace(/^enc:/, ''),
  };
}

const env = {
  APP_URL: 'https://gateway.example.com',
  APP_VERSION: 'v2.1.60',
} as never;

describe('LicenseService', () => {
  it('returns community without a key and does not call the server', async () => {
    const fetcher = vi.fn();
    const service = new LicenseService(createDb() as never, createCrypto() as never, env, fetcher as never);

    const status = await service.getStatus();

    expect(status.status).toBe('community');
    expect(status.tier).toBe('community');
    expect(status.licensed).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('activates and stores a valid homelab key', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'valid',
          tier: 'homelab',
          licenseName: 'Wiolett Test',
          expiresAt: null,
          activeInstallationId: 'install-1',
          activeInstallationName: 'gateway.example.com',
        }),
    });
    const service = new LicenseService(createDb() as never, createCrypto() as never, env, fetcher as never);

    const status = await service.activateKey('WLT-GW-AAAA-BBBB-CCCC-DDDD');

    expect(status.status).toBe('valid');
    expect(status.tier).toBe('homelab');
    expect(status.licenseName).toBe('Wiolett Test');
    expect(status.keyLast4).toBe('DDDD');
  });

  it('keeps last valid status during unreachable grace', async () => {
    const db = createDb();
    const firstFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'valid',
          tier: 'enterprise',
          licenseName: 'Enterprise',
          expiresAt: null,
          activeInstallationId: 'install-1',
        }),
    });
    const service = new LicenseService(db as never, createCrypto() as never, env, firstFetch as never);
    await service.activateKey('WLT-GW-AAAA-BBBB-CCCC-DDDD');

    const failedFetch = vi.fn().mockRejectedValue(new Error('network down'));
    const serviceAfterFailure = new LicenseService(db as never, createCrypto() as never, env, failedFetch as never);
    const status = await serviceAfterFailure.checkNow();

    expect(status.status).toBe('valid_with_warning');
    expect(status.tier).toBe('enterprise');
    expect(status.licensed).toBe(true);
    expect(status.graceUntil).toBeTruthy();
  });

  it('surfaces replaced status from heartbeat', async () => {
    const db = createDb();
    db.rows.set('license:key_encrypted', { encryptedKey: 'enc:WLT-GW-AAAA-BBBB-CCCC-DDDD', encryptedDek: 'dek' });
    db.rows.set('license:installation_id', 'install-1');
    db.rows.set('license:cached_state', {
      status: 'valid',
      tier: 'homelab',
      licenseName: 'Homelab',
      expiresAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastValidAt: new Date().toISOString(),
      activeInstallationId: 'install-1',
      activeInstallationName: 'gateway-1',
      errorMessage: null,
    });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'replaced',
          tier: 'homelab',
          licenseName: 'Homelab',
          activeInstallationId: 'install-2',
        }),
    });
    const service = new LicenseService(db as never, createCrypto() as never, env, fetcher as never);

    const status = await service.checkNow();

    expect(status.status).toBe('replaced');
    expect(status.licensed).toBe(false);
    expect(status.activeInstallationId).toBe('install-2');
  });

  it('refreshes legacy cached status without a license name', async () => {
    const db = createDb();
    db.rows.set('license:key_encrypted', { encryptedKey: 'enc:WLT-GW-AAAA-BBBB-CCCC-DDDD', encryptedDek: 'dek' });
    db.rows.set('license:installation_id', 'install-1');
    db.rows.set('license:cached_state', {
      status: 'valid',
      tier: 'enterprise',
      expiresAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastValidAt: new Date().toISOString(),
      activeInstallationId: 'install-1',
      activeInstallationName: 'localhost',
      errorMessage: null,
    });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'valid',
          tier: 'enterprise',
          licenseName: 'Wiolett Test',
          activeInstallationId: 'install-1',
          activeInstallationName: 'localhost',
        }),
    });
    const service = new LicenseService(db as never, createCrypto() as never, env, fetcher as never);

    const status = await service.getStatus();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(status.licenseName).toBe('Wiolett Test');
  });
});
