import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Env } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
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

    if (!certPath || !keyPath) {
      const autoDir = process.env.GRPC_TLS_AUTO_DIR || '/var/lib/gateway/tls';
      const autoCert = await this.systemCA.ensureGrpcServerCert(
        `${autoDir}/grpc-server.crt`,
        `${autoDir}/grpc-server.key`
      );
      certPath = autoCert.certPath;
      keyPath = autoCert.keyPath;
    }

    const gatewayCertSha256 = GrpcIdentityService.computeCertificateSha256(readFileSync(certPath));
    this.identity = { certPath, keyPath, gatewayCertSha256 };

    logger.info('Resolved gRPC server identity', { certPath, gatewayCertSha256 });
    return this.identity;
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
}
