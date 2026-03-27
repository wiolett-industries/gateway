import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { TOKENS } from '@/container.js';
import { certificates, certificateAuthorities } from '@/db/schema/index.js';
import { CryptoService } from '@/services/crypto.service.js';
import { CAService } from './ca.service.js';
import { CacheService } from '@/services/cache.service.js';
import { getEnv } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';

const logger = createChildLogger('OCSPService');

const OCSP_CACHE_PREFIX = 'ocsp:';

// OCSP response status codes
const OCSP_RESPONSE_STATUS = {
  SUCCESSFUL: 0,
  MALFORMED_REQUEST: 1,
  INTERNAL_ERROR: 2,
  UNAUTHORIZED: 6,
} as const;

// Certificate status
const CERT_STATUS = {
  GOOD: 0,
  REVOKED: 1,
  UNKNOWN: 2,
} as const;

@injectable()
export class OCSPService {
  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService,
    private readonly caService: CAService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Handle an OCSP request. For now, returns a basic signed OCSP response.
   * Full ASN.1 OCSP parsing/building would use @peculiar/asn1-ocsp.
   * This is a simplified implementation that responds with the certificate status.
   */
  async handleOCSPRequest(caId: string, requestBody: Buffer): Promise<Buffer> {
    try {
      // For a full implementation, we'd parse the OCSP request using @peculiar/asn1-ocsp
      // and extract the serial number being queried. For now, return a basic response
      // indicating the service is available.

      // This is a placeholder that returns a minimal OCSP response
      // A full implementation would:
      // 1. Parse OCSPRequest ASN.1 structure
      // 2. Extract CertID (serial number)
      // 3. Look up certificate status
      // 4. Build and sign OCSPResponse

      logger.warn('OCSP request received — full ASN.1 parsing not yet implemented', { caId });

      // Return a "tryLater" response for now
      return this.buildMinimalOCSPResponse(OCSP_RESPONSE_STATUS.INTERNAL_ERROR);
    } catch (error) {
      logger.error('OCSP request handling failed', { caId, error });
      return this.buildMinimalOCSPResponse(OCSP_RESPONSE_STATUS.INTERNAL_ERROR);
    }
  }

  /**
   * Check certificate status by serial number (used for API-based status checks).
   */
  async getCertificateStatus(caId: string, serialNumber: string): Promise<{
    status: 'good' | 'revoked' | 'unknown';
    revokedAt?: Date;
    revocationReason?: string;
  }> {
    const cert = await this.db.query.certificates.findFirst({
      where: and(
        eq(certificates.caId, caId),
        eq(certificates.serialNumber, serialNumber),
      ),
    });

    if (!cert) {
      return { status: 'unknown' };
    }

    if (cert.status === 'revoked') {
      return {
        status: 'revoked',
        revokedAt: cert.revokedAt || undefined,
        revocationReason: cert.revocationReason || undefined,
      };
    }

    if (cert.status === 'expired' || cert.notAfter < new Date()) {
      return { status: 'revoked', revokedAt: cert.notAfter, revocationReason: 'expired' };
    }

    return { status: 'good' };
  }

  async generateOCSPResponderCert(caId: string): Promise<void> {
    // Generate a delegated OCSP signing certificate for the CA
    // This cert is used to sign OCSP responses without exposing the CA key
    const { ca, privateKeyPem: caPrivateKeyPem } = await this.caService.getCASigningMaterials(caId);

    const { publicKeyPem, privateKeyPem } = this.cryptoService.generateKeyPair(ca.keyAlgorithm);

    const serialNumber = this.cryptoService.generateSerialNumber();
    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 1); // OCSP responder cert valid for 1 year

    // Encrypt OCSP responder key
    const encrypted = this.cryptoService.encryptPrivateKey(privateKeyPem);

    // TODO: Build OCSP responder certificate with id-kp-OCSPSigning EKU
    // For now, store the key material
    await this.db
      .update(certificateAuthorities)
      .set({
        encryptedOcspKey: encrypted.encryptedPrivateKey,
        encryptedOcspDek: encrypted.encryptedDek,
        ocspDekIv: encrypted.dekIv,
        updatedAt: new Date(),
      })
      .where(eq(certificateAuthorities.id, caId));

    logger.info('Generated OCSP responder key material', { caId });
  }

  async invalidateCache(caId: string, serialNumber: string): Promise<void> {
    await this.cacheService.delete(`${OCSP_CACHE_PREFIX}${caId}:${serialNumber}`);
  }

  private buildMinimalOCSPResponse(status: number): Buffer {
    // Build a minimal OCSPResponse with just the responseStatus
    // OCSPResponse ::= SEQUENCE { responseStatus ENUMERATED }
    const statusByte = Buffer.from([status]);
    const enumerated = Buffer.concat([
      Buffer.from([0x0a, 0x01]), // ENUMERATED tag + length 1
      statusByte,
    ]);
    const sequence = Buffer.concat([
      Buffer.from([0x30, enumerated.length]), // SEQUENCE tag + length
      enumerated,
    ]);
    return sequence;
  }
}
