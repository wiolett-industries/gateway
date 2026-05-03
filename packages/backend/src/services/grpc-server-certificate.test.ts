import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { describe, expect, it } from 'vitest';
import { validateGrpcServerCertificate } from './grpc-server-certificate.js';

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  const raw = await webcrypto.subtle.exportKey('pkcs8', key);
  return x509.PemConverter.encode(raw, 'PRIVATE KEY');
}

async function createEcdsaServerCertificatePair() {
  const now = Date.now();
  const caAlgorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const caKeys = await webcrypto.subtle.generateKey(
    {
      ...caAlgorithm,
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify']
  );
  const caCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=gateway-system-ca',
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 86_400_000),
    keys: caKeys,
    signingAlgorithm: caAlgorithm,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
    ],
  });

  const leafAlgorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const leafKeys = await webcrypto.subtle.generateKey(leafAlgorithm, true, ['sign', 'verify']);
  const leafCert = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=gateway-grpc',
    issuer: caCert.subject,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 86_400_000),
    publicKey: leafKeys.publicKey,
    signingKey: caKeys.privateKey,
    signingAlgorithm: caAlgorithm,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'localhost' }], true),
    ],
  });

  return {
    caPem: caCert.toString('pem'),
    certPem: leafCert.toString('pem'),
    keyPem: await exportPrivateKeyPem(leafKeys.privateKey),
  };
}

describe('validateGrpcServerCertificate', () => {
  it('accepts ECDSA TLS server certificates issued by the Gateway system CA', async () => {
    const { caPem, certPem, keyPem } = await createEcdsaServerCertificatePair();

    expect(() => validateGrpcServerCertificate(certPem, keyPem, caPem)).not.toThrow();
  });
});
