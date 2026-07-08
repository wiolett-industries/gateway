import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { SSLService } from './ssl.service.js';

describe('SSLService DNS-01 renewal', () => {
  it('does not persist a pending renewal when Cloudflare provisioning fails', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      acmeChallengeType: 'dns-01',
      acmeProvider: 'letsencrypt',
      domainNames: ['example.com'],
      notAfter: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    };
    const update = vi.fn();
    const db = {
      query: {
        sslCertificates: {
          findFirst: vi.fn().mockResolvedValue(cert),
        },
      },
      update,
    } as any;
    const acmeService = {
      requestCertDNS01Start: vi.fn().mockResolvedValue({
        accountKey: 'account-key',
        orderUrl: 'https://acme.test/order/1',
        challenges: [
          {
            domain: 'example.com',
            recordName: '_acme-challenge.example.com',
            recordValue: 'challenge-token',
          },
        ],
      }),
    } as any;
    const cryptoService = {
      encryptPrivateKey: vi.fn().mockReturnValue({
        encryptedPrivateKey: 'encrypted',
        encryptedDek: 'dek',
        dekIv: 'iv',
      }),
    } as any;
    const integrationsService = {
      resolveCloudflareDnsContext: vi
        .fn()
        .mockRejectedValue(new AppError(502, 'CLOUDFLARE_UNAVAILABLE', 'Cloudflare unavailable')),
    } as any;
    const service = new SSLService(db, acmeService, {} as any, cryptoService, { log: vi.fn() } as any, {} as any);
    service.setIntegrationsService(integrationsService);

    await expect(service.renewCert('cert-1', 'user-1')).rejects.toMatchObject({
      code: 'CLOUDFLARE_UNAVAILABLE',
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('clears pending renewal state when automatic Cloudflare verification fails', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      acmeChallengeType: 'dns-01',
      acmeProvider: 'letsencrypt',
      domainNames: ['example.com'],
      acmeAccountKey: JSON.stringify({
        encrypted: 'encrypted-account-key',
        encryptedDek: 'account-dek',
        dekIv: 'account-iv',
      }),
      acmeOrderUrl: 'https://acme.test/order/1',
      acmePendingOperation: 'renewal',
      acmePendingChallenges: [
        {
          domain: 'example.com',
          recordName: '_acme-challenge.example.com',
          recordValue: 'challenge-token',
          cloudflare: {
            connectorId: 'connector-1',
            zoneId: 'zone-1',
            zoneName: 'example.com',
            recordId: 'record-1',
            created: true,
          },
        },
      ],
    };
    const set = vi.fn().mockReturnValue({ where: vi.fn() });
    const db = {
      query: {
        sslCertificates: {
          findFirst: vi.fn().mockResolvedValue(cert),
        },
      },
      update: vi.fn().mockReturnValue({ set }),
    } as any;
    const acmeService = {
      requestCertDNS01Verify: vi.fn().mockRejectedValue(new Error('DNS record not visible yet')),
    } as any;
    const cryptoService = {
      decryptPrivateKey: vi.fn().mockReturnValue('account-key'),
      encryptPrivateKey: vi.fn(),
    } as any;
    const integrationsService = {
      getCloudflareDnsContextForRecord: vi.fn().mockResolvedValue({
        client: { deleteDnsRecord: vi.fn().mockResolvedValue(undefined) },
      }),
    } as any;
    const service = new SSLService(db, acmeService, {} as any, cryptoService, { log: vi.fn() } as any, {} as any);
    service.setIntegrationsService(integrationsService);

    await expect(
      service.completeDNS01Verification('cert-1', 'user-1', {
        cleanupCloudflare: true,
        clearPendingOnFailure: true,
      })
    ).rejects.toMatchObject({
      code: 'DNS01_VERIFICATION_FAILED',
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        acmeOrderUrl: null,
        acmePendingOperation: null,
        acmePendingChallenges: null,
        renewalError: 'Renewal failed: DNS record not visible yet',
      })
    );
  });
});
