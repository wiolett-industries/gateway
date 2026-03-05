import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
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

@injectable()
export class OCSPService {
  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService,
    private readonly caService: CAService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Handle an OCSP request (DER-encoded).
   * Full ASN.1 OCSP implementation would use @peculiar/asn1-ocsp.
   * Currently returns a basic "tryLater" response.
   */
  async handleOCSPRequest(caId: string, requestBody: Buffer): Promise<Buffer> {
    try {
      logger.debug('OCSP request received', { caId, size: requestBody.length });
      // TODO: Full ASN.1 OCSP request parsing and response signing
      return this.buildMinimalOCSPResponse(2); // internalError / tryLater
    } catch (error) {
      logger.error('OCSP request handling failed', { caId, error });
      return this.buildMinimalOCSPResponse(2);
    }
  }

  /**
   * Check certificate status by serial number (API-based lookup).
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

    if (!cert) return { status: 'unknown' };

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
    const { ca } = await this.caService.getCASigningMaterials(caId);
    const { publicKeyPem, privateKeyPem } = this.cryptoService.generateKeyPair(ca.keyAlgorithm);
    const encrypted = this.cryptoService.encryptPrivateKey(privateKeyPem);

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
    // Minimal OCSPResponse: SEQUENCE { responseStatus ENUMERATED }
    const statusByte = Buffer.from([status]);
    const enumerated = Buffer.concat([Buffer.from([0x0a, 0x01]), statusByte]);
    return Buffer.concat([Buffer.from([0x30, enumerated.length]), enumerated]);
  }
}
