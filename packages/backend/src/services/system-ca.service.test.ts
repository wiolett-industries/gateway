import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemCAService } from './system-ca.service.js';

function createCertificatePair(options: { serverAuth?: boolean; clientAuth?: boolean } = {}) {
  const { serverAuth = true, clientAuth = false } = options;
  const now = Date.now();
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(now - 60_000);
  caCert.validity.notAfter = new Date(now + 30 * 86_400_000);
  caCert.setSubject([{ name: 'commonName', value: 'gateway-system-ca' }]);
  caCert.setIssuer(caCert.subject.attributes);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const leafKeys = forge.pki.rsa.generateKeyPair(2048);
  const leafCert = forge.pki.createCertificate();
  leafCert.publicKey = leafKeys.publicKey;
  leafCert.serialNumber = '02';
  leafCert.validity.notBefore = new Date(now - 60_000);
  leafCert.validity.notAfter = new Date(now + 30 * 86_400_000);
  leafCert.setSubject([{ name: 'commonName', value: 'gateway-grpc' }]);
  leafCert.setIssuer(caCert.subject.attributes);
  const extKeyUsage: { name: 'extKeyUsage'; serverAuth?: boolean; clientAuth?: boolean } = { name: 'extKeyUsage' };
  if (serverAuth) extKeyUsage.serverAuth = true;
  if (clientAuth) extKeyUsage.clientAuth = true;
  leafCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    extKeyUsage,
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
  ]);
  leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

  return {
    caPem: forge.pki.certificateToPem(caCert),
    certPem: forge.pki.certificateToPem(leafCert),
    keyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
  };
}

function createDb(results: unknown[][]) {
  const limit = vi.fn();
  for (const result of results) {
    limit.mockResolvedValueOnce(result);
  }
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })) };
}

describe('SystemCAService.ensureGrpcServerCert', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeTlsFiles(certPem: string, keyPem: string) {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-system-ca-test-'));
    tempDirs.push(dir);
    const certPath = join(dir, 'grpc-server.crt');
    const keyPath = join(dir, 'grpc-server.key');
    writeFileSync(certPath, certPem);
    writeFileSync(keyPath, keyPem);
    return { certPath, keyPath };
  }

  function createService(dbResults: unknown[][], issueResult = createCertificatePair()) {
    const certService = {
      issueCertificate: vi.fn().mockResolvedValue({
        certificate: { certificatePem: issueResult.certPem, serialNumber: 'serial-1' },
        privateKeyPem: issueResult.keyPem,
      }),
    };
    const service = new SystemCAService(createDb(dbResults) as any, {} as any, certService as any, {} as any);
    return { service, certService };
  }

  it('reuses existing auto gRPC TLS material when it is valid for the current system CA', async () => {
    const { caPem, certPem, keyPem } = createCertificatePair();
    const { certPath, keyPath } = writeTlsFiles(certPem, keyPem);
    const { service, certService } = createService([[{ certificatePem: caPem }]]);

    await expect(service.ensureGrpcServerCert(certPath, keyPath)).resolves.toEqual({ certPath, keyPath });
    expect(certService.issueCertificate).not.toHaveBeenCalled();
  });

  it('regenerates existing auto gRPC TLS material when it was issued by a different CA', async () => {
    const { certPem, keyPem } = createCertificatePair();
    const { caPem: currentCaPem } = createCertificatePair();
    const replacement = createCertificatePair();
    const { certPath, keyPath } = writeTlsFiles(certPem, keyPem);
    const { service, certService } = createService(
      [[{ certificatePem: currentCaPem }], [{ id: 'system-ca-id' }]],
      replacement
    );

    await expect(service.ensureGrpcServerCert(certPath, keyPath)).resolves.toEqual({ certPath, keyPath });
    expect(certService.issueCertificate).toHaveBeenCalledTimes(1);
  });

  it('regenerates existing auto gRPC TLS material when the key does not match', async () => {
    const { caPem, certPem } = createCertificatePair();
    const { keyPem: otherKeyPem } = createCertificatePair();
    const replacement = createCertificatePair();
    const { certPath, keyPath } = writeTlsFiles(certPem, otherKeyPem);
    const { service, certService } = createService(
      [[{ certificatePem: caPem }], [{ id: 'system-ca-id' }]],
      replacement
    );

    await expect(service.ensureGrpcServerCert(certPath, keyPath)).resolves.toEqual({ certPath, keyPath });
    expect(certService.issueCertificate).toHaveBeenCalledTimes(1);
  });

  it('regenerates existing auto gRPC TLS material when the certificate lacks serverAuth', async () => {
    const { caPem, certPem, keyPem } = createCertificatePair({ serverAuth: false, clientAuth: true });
    const replacement = createCertificatePair();
    const { certPath, keyPath } = writeTlsFiles(certPem, keyPem);
    const { service, certService } = createService(
      [[{ certificatePem: caPem }], [{ id: 'system-ca-id' }]],
      replacement
    );

    await expect(service.ensureGrpcServerCert(certPath, keyPath)).resolves.toEqual({ certPath, keyPath });
    expect(certService.issueCertificate).toHaveBeenCalledTimes(1);
  });
});
