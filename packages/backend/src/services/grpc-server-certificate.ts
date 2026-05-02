import { createPrivateKey, X509Certificate } from 'node:crypto';
import forge from 'node-forge';

export function validateGrpcServerCertificate(
  certificatePem: string | Buffer,
  privateKeyPem: string | Buffer,
  caPem: string | null | undefined
): void {
  if (!caPem) {
    throw new Error('Gateway system CA certificate is unavailable');
  }

  try {
    const cert = new X509Certificate(certificatePem);
    const ca = new X509Certificate(caPem);
    if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) {
      throw new Error('certificate is not signed by the Gateway system CA');
    }
    if (!cert.checkPrivateKey(createPrivateKey(privateKeyPem))) {
      throw new Error('private key does not match certificate');
    }
    const forgeCert = forge.pki.certificateFromPem(certificatePem.toString());
    const basicConstraints = forgeCert.getExtension('basicConstraints') as { cA?: boolean } | undefined;
    if (cert.ca || basicConstraints?.cA) {
      throw new Error('certificate must be an end-entity TLS server certificate');
    }
    const extKeyUsage = forgeCert.getExtension('extKeyUsage') as { serverAuth?: boolean } | undefined;
    if (!extKeyUsage?.serverAuth) {
      throw new Error('certificate must allow TLS server authentication');
    }

    const now = Date.now();
    const validFrom = Date.parse(cert.validFrom);
    const validTo = Date.parse(cert.validTo);
    if (Number.isFinite(validFrom) && now < validFrom) {
      throw new Error('certificate is not valid yet');
    }
    if (Number.isFinite(validTo) && now > validTo) {
      throw new Error('certificate is expired');
    }
  } catch (error) {
    throw new Error(`Invalid gRPC TLS certificate: ${(error as Error).message}`);
  }
}
