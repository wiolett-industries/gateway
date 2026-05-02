import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Env } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
import { validateGrpcServerCertificate } from './grpc-server-certificate.js';
import type { SystemCAService } from './system-ca.service.js';

const logger = createChildLogger('GrpcIdentity');

export interface GrpcIdentity {
  certPath: string;
  keyPath: string;
  gatewayCertSha256: string;
}

export class GrpcIdentityService {
  private identity: GrpcIdentity | null = null;

  constructor(
    private readonly env: Env,
    private readonly systemCA: SystemCAService
  ) {}

  async resolve(): Promise<GrpcIdentity> {
    if (this.identity) {
      return this.identity;
    }

    let certPath = this.env.GRPC_TLS_CERT;
    let keyPath = this.env.GRPC_TLS_KEY;

    if ((certPath && !keyPath) || (!certPath && keyPath)) {
      throw new Error('GRPC_TLS_CERT and GRPC_TLS_KEY must be configured together');
    }

    if (!certPath && !keyPath) {
      const autoCert = await this.systemCA.ensureGrpcServerCert(
        `${this.env.GRPC_TLS_AUTO_DIR}/grpc-server.crt`,
        `${this.env.GRPC_TLS_AUTO_DIR}/grpc-server.key`
      );
      certPath = autoCert.certPath;
      keyPath = autoCert.keyPath;
    } else {
      const customCertPath = certPath!;
      const customKeyPath = keyPath!;
      await this.validateCustomServerCertificate(readFileSync(customCertPath), readFileSync(customKeyPath));
    }

    const resolvedCertPath = certPath!;
    const resolvedKeyPath = keyPath!;
    const gatewayCertSha256 = GrpcIdentityService.computeCertificateSha256(readFileSync(resolvedCertPath));
    const identity = { certPath: resolvedCertPath, keyPath: resolvedKeyPath, gatewayCertSha256 };
    this.identity = identity;

    logger.info('Resolved gRPC server identity', { certPath: resolvedCertPath, gatewayCertSha256 });
    return identity;
  }

  async getGatewayCertSha256(): Promise<string> {
    return (await this.resolve()).gatewayCertSha256;
  }

  static computeCertificateSha256(certificatePem: string | Buffer): string {
    try {
      const cert = new X509Certificate(certificatePem);
      return `sha256:${createHash('sha256').update(cert.raw).digest('hex')}`;
    } catch (error) {
      throw new Error(`Invalid gRPC TLS certificate PEM: ${(error as Error).message}`);
    }
  }

  private async validateCustomServerCertificate(
    certificatePem: string | Buffer,
    privateKeyPem: string | Buffer
  ): Promise<void> {
    const caPem = await this.systemCA.getSystemCACertPem();
    try {
      validateGrpcServerCertificate(certificatePem, privateKeyPem, caPem);
    } catch (error) {
      const message = (error as Error).message.replace(/^Invalid gRPC TLS certificate: /, '');
      throw new Error(`Invalid custom gRPC TLS certificate: ${message}`);
    }
  }
}
