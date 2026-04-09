import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { x509 } from '@/lib/x509.js';
import { TOKENS } from '@/container.js';
import { certificates, certificateAuthorities } from '@/db/schema/index.js';
import { CryptoService } from '@/services/crypto.service.js';
import { CAService } from './ca.service.js';
import { CacheService } from '@/services/cache.service.js';
import { getEnv } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';

const logger = createChildLogger('CRLService');

const CRL_CACHE_PREFIX = 'crl:';

@injectable()
export class CRLService {
  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService,
    private readonly caService: CAService,
    private readonly cacheService: CacheService,
  ) {}

  async getCRL(caId: string): Promise<Buffer> {
    // Check cache first
    const cached = await this.cacheService.get<string>(`${CRL_CACHE_PREFIX}${caId}`);
    if (cached) {
      return Buffer.from(cached, 'base64');
    }

    return this.generateCRL(caId);
  }

  async generateCRL(caId: string): Promise<Buffer> {
    const env = getEnv();
    const { ca, privateKeyPem } = await this.caService.getCASigningMaterials(caId);

    // Get all revoked certificates for this CA
    const revokedCerts = await this.db.query.certificates.findMany({
      where: and(
        eq(certificates.caId, caId),
        eq(certificates.status, 'revoked'),
      ),
      columns: {
        serialNumber: true,
        revokedAt: true,
        revocationReason: true,
      },
    });

    const algorithm = this.caService.getAlgorithm(ca.keyAlgorithm);
    const caKeys = await this.caService.importKeyPair(ca.certificatePem, privateKeyPem, algorithm, true);

    // Increment CRL number
    const newCrlNumber = ca.crlNumber + 1;

    // Build CRL entries
    const entries = revokedCerts.map(cert => ({
      serialNumber: cert.serialNumber,
      revocationDate: cert.revokedAt || new Date(),
    })) as unknown as x509.X509CrlEntry[];

    const thisUpdate = new Date();
    const nextUpdate = new Date();
    nextUpdate.setHours(nextUpdate.getHours() + env.DEFAULT_CRL_VALIDITY_HOURS);

    const crl = await x509.X509CrlGenerator.create({
      issuer: ca.subjectDn,
      thisUpdate,
      nextUpdate,
      entries,
      signingKey: caKeys.privateKey,
      signingAlgorithm: algorithm,
    });

    const crlDer = Buffer.from(crl.rawData);

    // Update CA CRL tracking
    await this.db
      .update(certificateAuthorities)
      .set({ crlNumber: newCrlNumber, lastCrlAt: new Date(), updatedAt: new Date() })
      .where(eq(certificateAuthorities.id, caId));

    // Cache the CRL
    const ttlSeconds = env.DEFAULT_CRL_VALIDITY_HOURS * 3600;
    await this.cacheService.set(
      `${CRL_CACHE_PREFIX}${caId}`,
      crlDer.toString('base64'),
      ttlSeconds
    );

    logger.info('Generated CRL', { caId, entries: entries.length, crlNumber: newCrlNumber });

    return crlDer;
  }

  async invalidateCache(caId: string): Promise<void> {
    await this.cacheService.delete(`${CRL_CACHE_PREFIX}${caId}`);
  }
}
