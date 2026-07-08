import { describe, expect, it, vi } from 'vitest';
import { ACMERenewalJob } from './acme-renewal.job.js';

function createDb(certs: unknown[]) {
  return {
    query: {
      sslCertificates: {
        findMany: vi.fn().mockResolvedValue(certs),
      },
    },
  };
}

describe('ACMERenewalJob', () => {
  it('attempts automatic renewal for DNS-01 certificates', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      autoRenew: true,
      acmeChallengeType: 'dns-01',
      domainNames: ['example.com'],
      notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
    const db = createDb([cert]);
    const sslService = {
      renewCert: vi.fn().mockResolvedValue({ id: 'cert-1', status: 'active' }),
    };
    const alertService = { createAlert: vi.fn() };
    const job = new ACMERenewalJob(db as never, sslService as never, alertService as never);

    await job.run();

    expect(sslService.renewCert).toHaveBeenCalledWith('cert-1', '00000000-0000-0000-0000-000000000000');
    expect(alertService.createAlert).not.toHaveBeenCalled();
  });

  it('alerts when DNS-01 renewal still needs manual verification', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      autoRenew: true,
      acmeChallengeType: 'dns-01',
      domainNames: ['example.com'],
      notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
    const db = createDb([cert]);
    const sslService = {
      renewCert: vi.fn().mockResolvedValue({ id: 'cert-1', status: 'pending' }),
    };
    const alertService = { createAlert: vi.fn() };
    const job = new ACMERenewalJob(db as never, sslService as never, alertService as never);

    await job.run();

    expect(sslService.renewCert).toHaveBeenCalledWith('cert-1', '00000000-0000-0000-0000-000000000000');
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'expiry_warning',
        resourceType: 'ssl_certificate',
        resourceId: 'cert-1',
      })
    );
  });

  it('does not start a new order for certificates already pending DNS-01 renewal', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      autoRenew: true,
      acmeChallengeType: 'dns-01',
      acmePendingOperation: 'renewal',
      acmePendingChallenges: [
        {
          domain: 'example.com',
          recordName: '_acme-challenge.example.com',
          recordValue: 'challenge-token',
        },
      ],
      domainNames: ['example.com'],
      notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
    const db = createDb([cert]);
    const sslService = {
      renewCert: vi.fn(),
      completeDNS01Verification: vi.fn(),
    };
    const alertService = { createAlert: vi.fn() };
    const job = new ACMERenewalJob(db as never, sslService as never, alertService as never);

    await job.run();

    expect(db.query.sslCertificates.findMany).toHaveBeenCalled();
    expect(sslService.renewCert).not.toHaveBeenCalled();
    expect(sslService.completeDNS01Verification).not.toHaveBeenCalled();
    expect(alertService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'expiry_warning',
        resourceType: 'ssl_certificate',
        resourceId: 'cert-1',
      })
    );
  });

  it('completes pending Cloudflare DNS-01 renewals instead of starting a new order', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      type: 'acme',
      status: 'active',
      autoRenew: true,
      acmeChallengeType: 'dns-01',
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
      domainNames: ['example.com'],
      notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
    const db = createDb([cert]);
    const sslService = {
      renewCert: vi.fn(),
      completeDNS01Verification: vi.fn().mockResolvedValue({ id: 'cert-1', status: 'active' }),
    };
    const alertService = { createAlert: vi.fn() };
    const job = new ACMERenewalJob(db as never, sslService as never, alertService as never);

    await job.run();

    expect(sslService.renewCert).not.toHaveBeenCalled();
    expect(sslService.completeDNS01Verification).toHaveBeenCalledWith(
      'cert-1',
      '00000000-0000-0000-0000-000000000000',
      {
        cleanupCloudflare: true,
        clearPendingOnFailure: true,
      }
    );
    expect(alertService.createAlert).not.toHaveBeenCalled();
  });
});
