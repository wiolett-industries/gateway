import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import * as x509 from '@peculiar/x509';
import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { certificateAuthorities } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import type { CertService } from '@/modules/pki/cert.service.js';
import type { CryptoService } from './crypto.service.js';

const logger = createChildLogger('SystemCA');

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_CA_CN = 'Gateway Node CA';

export class SystemCAService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly caService: CAService,
    private readonly certService: CertService,
    readonly _cryptoService: CryptoService
  ) {}

  /** Ensure the system CA exists. Creates it on first startup. Returns its ID. */
  async ensureSystemCA(): Promise<string> {
    const [existing] = await this.db
      .select({ id: certificateAuthorities.id })
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.isSystem, true))
      .limit(1);

    if (existing) return existing.id;

    logger.info('Creating system CA for node mTLS...');

    const ca = await this.caService.createRootCA(
      {
        commonName: SYSTEM_CA_CN,
        keyAlgorithm: 'ecdsa-p256',
        validityYears: 10,
        maxValidityDays: 3650,
        pathLengthConstraint: 0,
      },
      SYSTEM_USER_ID
    );

    await this.db.update(certificateAuthorities).set({ isSystem: true }).where(eq(certificateAuthorities.id, ca.id));

    logger.info('System CA created', { caId: ca.id });
    return ca.id;
  }

  /** Get the system CA certificate PEM (for gRPC mTLS verification). */
  async getSystemCACertPem(): Promise<string | null> {
    const [ca] = await this.db
      .select({ certificatePem: certificateAuthorities.certificatePem })
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.isSystem, true))
      .limit(1);
    return ca?.certificatePem ?? null;
  }

  /** Get the system CA ID (throws if not found). */
  async getSystemCAId(): Promise<string> {
    const [ca] = await this.db
      .select({ id: certificateAuthorities.id })
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.isSystem, true))
      .limit(1);

    if (!ca) throw new Error('System CA not found — run ensureSystemCA first');
    return ca.id;
  }

  /**
   * Ensure the gRPC server has a TLS certificate issued by the system CA.
   * Returns the cert/key file paths. Reuses existing files if still valid.
   */
  async ensureGrpcServerCert(certPath: string, keyPath: string): Promise<{ certPath: string; keyPath: string }> {
    // Reuse if files exist and cert is still valid (> 7 days remaining)
    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        const certPem = readFileSync(certPath, 'utf-8');
        if (certPem.includes('BEGIN CERTIFICATE')) {
          const cert = new x509.X509Certificate(certPem);
          const remaining = cert.notAfter.getTime() - Date.now();
          if (remaining > 7 * 24 * 60 * 60 * 1000) {
            logger.debug('Reusing existing gRPC server cert', {
              expiresAt: cert.notAfter.toISOString(),
            });
            return { certPath, keyPath };
          }
          logger.info('gRPC server cert expiring soon, regenerating', {
            remaining: `${Math.round(remaining / 3600000)}h`,
          });
        }
      } catch {
        // Files exist but can't read/parse — regenerate
      }
    }

    logger.info('Issuing gRPC server TLS certificate from system CA...');

    const caId = await this.getSystemCAId();
    const host = hostname();

    const result = await this.certService.issueCertificate(
      {
        caId,
        type: 'tls-server',
        commonName: 'gateway-grpc',
        sans: ['localhost', host, '127.0.0.1', ...(process.env.GRPC_TLS_EXTRA_SANS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])],
        keyAlgorithm: 'ecdsa-p256',
        validityDays: 365,
      },
      SYSTEM_USER_ID
    );

    // Write cert and key to disk
    mkdirSync(dirname(certPath), { recursive: true });
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(certPath, result.certificate.certificatePem, { mode: 0o644 });
    writeFileSync(keyPath, result.privateKeyPem, { mode: 0o600 });

    logger.info('gRPC server cert issued', { serial: result.certificate.serialNumber, certPath });
    return { certPath, keyPath };
  }

  /** Issue a TLS client cert for a daemon node using the system CA. */
  async issueNodeCert(
    nodeId: string,
    hostname: string
  ): Promise<{
    caCertPem: string;
    certPem: string;
    keyPem: string;
    serial: string;
    expiresAt: Date;
  }> {
    const caId = await this.getSystemCAId();

    const [ca] = await this.db
      .select({ certificatePem: certificateAuthorities.certificatePem })
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    const result = await this.certService.issueCertificate(
      {
        caId,
        type: 'tls-client',
        commonName: nodeId,
        sans: [hostname],
        keyAlgorithm: 'ecdsa-p256',
        validityDays: 365,
      },
      SYSTEM_USER_ID
    );

    return {
      caCertPem: ca!.certificatePem,
      certPem: result.certificate.certificatePem,
      keyPem: result.privateKeyPem,
      serial: result.certificate.serialNumber,
      expiresAt: result.certificate.notAfter,
    };
  }
}
