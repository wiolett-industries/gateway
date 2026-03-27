import { injectable, inject } from 'tsyringe';
import { eq, and, or, ilike, desc, asc, count, lte } from 'drizzle-orm';
import * as x509 from '@peculiar/x509';
import crypto from 'node:crypto';
import { TOKENS } from '@/container.js';
import { certificates, certificateAuthorities } from '@/db/schema/index.js';
import { CryptoService } from '@/services/crypto.service.js';
import { CAService } from './ca.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { AppError } from '@/middleware/error-handler.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';
import type { IssueCertificateInput, IssueCertFromCSRInput, CertificateListQuery } from './cert.schemas.js';
import type { PaginatedResponse } from '@/types.js';

const logger = createChildLogger('CertService');

x509.cryptoProvider.set(crypto.webcrypto as any);

// Map string key usage to @peculiar/x509 flags
const KEY_USAGE_MAP: Record<string, number> = {
  digitalSignature: x509.KeyUsageFlags.digitalSignature,
  keyEncipherment: x509.KeyUsageFlags.keyEncipherment,
  dataEncipherment: x509.KeyUsageFlags.dataEncipherment,
  keyAgreement: x509.KeyUsageFlags.keyAgreement,
  nonRepudiation: x509.KeyUsageFlags.nonRepudiation,
};

@injectable()
export class CertService {
  constructor(
    @inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService,
    private readonly caService: CAService,
    private readonly auditService: AuditService,
  ) {}

  async issueCertificate(input: IssueCertificateInput, userId: string) {
    const { ca, privateKeyPem: caPrivateKeyPem } = await this.caService.getCASigningMaterials(input.caId);

    // Validate validity
    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setDate(notAfter.getDate() + input.validityDays);

    if (input.validityDays > ca.maxValidityDays) {
      throw new AppError(400, 'VALIDITY_EXCEEDED', `Validity exceeds CA maximum of ${ca.maxValidityDays} days`);
    }
    if (notAfter > ca.notAfter) {
      throw new AppError(400, 'VALIDITY_EXCEEDS_CA', 'Certificate validity exceeds CA validity');
    }

    const serialNumber = this.cryptoService.generateSerialNumber();
    const { publicKeyPem, privateKeyPem } = this.cryptoService.generateKeyPair(input.keyAlgorithm);

    const caAlgorithm = this.caService.getAlgorithm(ca.keyAlgorithm);
    const leafAlgorithm = this.caService.getAlgorithm(input.keyAlgorithm);
    const caKeys = await this.caService.importKeyPair(ca.certificatePem, caPrivateKeyPem, caAlgorithm, true);
    const leafPublicKey = await crypto.webcrypto.subtle.importKey(
      'spki',
      this.pemToBuffer(publicKeyPem, 'PUBLIC KEY'),
      leafAlgorithm,
      true,
      ['verify']
    );

    // Build extensions
    const keyUsageFlags = this.getKeyUsageFlags(input.type);
    const extensions: x509.Extension[] = [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(keyUsageFlags, true),
      await x509.SubjectKeyIdentifierExtension.create(leafPublicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caKeys.publicKey),
    ];

    // Add SAN extension
    if (input.sans.length > 0) {
      const sanBuilder = new x509.SubjectAlternativeNameExtension(
        this.buildSANs(input.sans),
        true
      );
      extensions.push(sanBuilder);
    }

    // Add Extended Key Usage
    const extKeyUsage = this.getExtKeyUsage(input.type);
    if (extKeyUsage.length > 0) {
      extensions.push(new x509.ExtendedKeyUsageExtension(extKeyUsage, false));
    }

    const cert = await x509.X509CertificateGenerator.create({
      serialNumber,
      subject: `CN=${input.commonName}`,
      issuer: ca.subjectDn,
      notBefore,
      notAfter,
      publicKey: leafPublicKey,
      signingKey: caKeys.privateKey,
      signingAlgorithm: caAlgorithm,
      extensions,
    });

    const certificatePem = cert.toString('pem');
    const encrypted = this.cryptoService.encryptPrivateKey(privateKeyPem);

    const [certificate] = await this.db.insert(certificates).values({
      caId: input.caId,
      templateId: input.templateId,
      type: input.type,
      commonName: input.commonName,
      sans: input.sans,
      serialNumber,
      certificatePem,
      encryptedPrivateKey: encrypted.encryptedPrivateKey,
      encryptedDek: encrypted.encryptedDek,
      dekIv: encrypted.dekIv,
      keyAlgorithm: input.keyAlgorithm,
      subjectDn: `CN=${input.commonName}`,
      issuerDn: ca.subjectDn,
      notBefore,
      notAfter,
      serverGenerated: true,
      keyUsage: this.getKeyUsageStrings(input.type),
      extKeyUsage: this.getExtKeyUsageStrings(input.type),
      issuedById: userId,
    }).returning();

    await this.auditService.log({
      userId,
      action: 'cert.issue',
      resourceType: 'certificate',
      resourceId: certificate.id,
      details: { type: input.type, caId: input.caId, cn: input.commonName, serverGenerated: true },
    });

    logger.info('Issued certificate', { certId: certificate.id, cn: input.commonName });

    return {
      certificate,
      privateKeyPem, // Returned ONCE at issuance for server-generated keys
    };
  }

  async issueCertificateFromCSR(input: IssueCertFromCSRInput, userId: string) {
    const { ca, privateKeyPem: caPrivateKeyPem } = await this.caService.getCASigningMaterials(input.caId);

    // Parse CSR
    let csr: x509.Pkcs10CertificateRequest;
    try {
      csr = new x509.Pkcs10CertificateRequest(input.csrPem);
    } catch {
      throw new AppError(400, 'INVALID_CSR', 'Failed to parse CSR');
    }

    // Extract CN from CSR subject
    const csrSubject = csr.subject;
    const cnMatch = csrSubject.match(/CN=([^,]+)/);
    const commonName = cnMatch ? cnMatch[1] : 'Unknown';

    // Use override SANs or extract from CSR
    const sans = input.overrideSans || [];

    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setDate(notAfter.getDate() + input.validityDays);

    if (input.validityDays > ca.maxValidityDays) {
      throw new AppError(400, 'VALIDITY_EXCEEDED', `Validity exceeds CA maximum of ${ca.maxValidityDays} days`);
    }

    const serialNumber = this.cryptoService.generateSerialNumber();
    const caAlgorithm = this.caService.getAlgorithm(ca.keyAlgorithm);
    const caKeys = await this.caService.importKeyPair(ca.certificatePem, caPrivateKeyPem, caAlgorithm, true);

    // Build extensions
    const keyUsageFlags = this.getKeyUsageFlags(input.type);
    const extensions: x509.Extension[] = [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(keyUsageFlags, true),
      await x509.AuthorityKeyIdentifierExtension.create(caKeys.publicKey),
    ];

    if (sans.length > 0) {
      extensions.push(new x509.SubjectAlternativeNameExtension(this.buildSANs(sans), true));
    }

    const extKeyUsage = this.getExtKeyUsage(input.type);
    if (extKeyUsage.length > 0) {
      extensions.push(new x509.ExtendedKeyUsageExtension(extKeyUsage, false));
    }

    // Detect key algorithm from CSR
    const csrPublicKey = await csr.publicKey.export(caAlgorithm, ['verify']).catch(() => null);
    let keyAlgorithm = ca.keyAlgorithm; // fallback

    const cert = await x509.X509CertificateGenerator.create({
      serialNumber,
      subject: `CN=${commonName}`,
      issuer: ca.subjectDn,
      notBefore,
      notAfter,
      publicKey: csr.publicKey,
      signingKey: caKeys.privateKey,
      signingAlgorithm: caAlgorithm,
      extensions,
    });

    const certificatePem = cert.toString('pem');

    const [certificate] = await this.db.insert(certificates).values({
      caId: input.caId,
      templateId: input.templateId,
      type: input.type,
      commonName,
      sans,
      serialNumber,
      certificatePem,
      keyAlgorithm,
      subjectDn: `CN=${commonName}`,
      issuerDn: ca.subjectDn,
      notBefore,
      notAfter,
      csrPem: input.csrPem,
      serverGenerated: false,
      keyUsage: this.getKeyUsageStrings(input.type),
      extKeyUsage: this.getExtKeyUsageStrings(input.type),
      issuedById: userId,
    }).returning();

    await this.auditService.log({
      userId,
      action: 'cert.issue',
      resourceType: 'certificate',
      resourceId: certificate.id,
      details: { type: input.type, caId: input.caId, cn: commonName, serverGenerated: false },
    });

    return certificate;
  }

  async getCertificate(id: string) {
    const cert = await this.db.query.certificates.findFirst({
      where: eq(certificates.id, id),
    });

    if (!cert) throw new AppError(404, 'CERT_NOT_FOUND', 'Certificate not found');

    return {
      ...cert,
      encryptedPrivateKey: undefined,
      encryptedDek: undefined,
      dekIv: undefined,
    };
  }

  async listCertificates(params: CertificateListQuery): Promise<PaginatedResponse<any>> {
    const conditions = [];
    if (params.caId) conditions.push(eq(certificates.caId, params.caId));
    if (params.status) conditions.push(eq(certificates.status, params.status));
    if (params.type) conditions.push(eq(certificates.type, params.type));
    if (params.search) {
      conditions.push(
        or(
          ilike(certificates.commonName, `%${params.search}%`),
          ilike(certificates.serialNumber, `%${params.search}%`),
        )!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderColumn = {
      commonName: certificates.commonName,
      createdAt: certificates.createdAt,
      notAfter: certificates.notAfter,
      type: certificates.type,
    }[params.sortBy] || certificates.createdAt;

    const orderFn = params.sortOrder === 'asc' ? asc : desc;

    const [entries, [{ count: totalCount }]] = await Promise.all([
      this.db.query.certificates.findMany({
        where: where ? () => where : undefined,
        orderBy: [orderFn(orderColumn)],
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
        columns: {
          encryptedPrivateKey: false,
          encryptedDek: false,
          dekIv: false,
        },
      }),
      this.db.select({ count: count() }).from(certificates).where(where),
    ]);

    const total = Number(totalCount);

    return {
      data: entries,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async revokeCertificate(id: string, reason: string, userId: string) {
    const cert = await this.db.query.certificates.findFirst({
      where: eq(certificates.id, id),
    });

    if (!cert) throw new AppError(404, 'CERT_NOT_FOUND', 'Certificate not found');
    if (cert.status !== 'active') throw new AppError(400, 'CERT_NOT_ACTIVE', 'Certificate is already revoked or expired');

    await this.db
      .update(certificates)
      .set({ status: 'revoked', revokedAt: new Date(), revocationReason: reason, updatedAt: new Date() })
      .where(eq(certificates.id, id));

    await this.auditService.log({
      userId,
      action: 'cert.revoke',
      resourceType: 'certificate',
      resourceId: id,
      details: { reason, caId: cert.caId },
    });

    logger.info('Revoked certificate', { certId: id, reason });
    return cert.caId; // Return CA ID for CRL regeneration
  }

  async getExpiringCertificates(withinDays: number) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + withinDays);

    return this.db.query.certificates.findMany({
      where: and(
        eq(certificates.status, 'active'),
        lte(certificates.notAfter, threshold),
      ),
      columns: {
        encryptedPrivateKey: false,
        encryptedDek: false,
        dekIv: false,
      },
    });
  }

  /**
   * Get the decrypted private key for a certificate (for export).
   * Returns null if the cert was CSR-based (server never had the key).
   */
  async getCertificatePrivateKey(id: string): Promise<string | null> {
    const cert = await this.db.query.certificates.findFirst({
      where: eq(certificates.id, id),
    });

    if (!cert || !cert.encryptedPrivateKey || !cert.encryptedDek) return null;

    return this.cryptoService.decryptPrivateKey({
      encryptedPrivateKey: cert.encryptedPrivateKey,
      encryptedDek: cert.encryptedDek,
      dekIv: cert.dekIv || '',
    });
  }

  // --- Helpers ---

  private getKeyUsageFlags(certType: string): number {
    switch (certType) {
      case 'tls-server':
        return x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment;
      case 'tls-client':
        return x509.KeyUsageFlags.digitalSignature;
      case 'code-signing':
        return x509.KeyUsageFlags.digitalSignature;
      case 'email':
        return x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment;
      default:
        return x509.KeyUsageFlags.digitalSignature;
    }
  }

  private getKeyUsageStrings(certType: string): string[] {
    switch (certType) {
      case 'tls-server': return ['digitalSignature', 'keyEncipherment'];
      case 'tls-client': return ['digitalSignature'];
      case 'code-signing': return ['digitalSignature'];
      case 'email': return ['digitalSignature', 'keyEncipherment'];
      default: return ['digitalSignature'];
    }
  }

  private getExtKeyUsage(certType: string): string[] {
    switch (certType) {
      case 'tls-server': return ['1.3.6.1.5.5.7.3.1']; // serverAuth
      case 'tls-client': return ['1.3.6.1.5.5.7.3.2']; // clientAuth
      case 'code-signing': return ['1.3.6.1.5.5.7.3.3']; // codeSigning
      case 'email': return ['1.3.6.1.5.5.7.3.4']; // emailProtection
      default: return [];
    }
  }

  private getExtKeyUsageStrings(certType: string): string[] {
    switch (certType) {
      case 'tls-server': return ['serverAuth'];
      case 'tls-client': return ['clientAuth'];
      case 'code-signing': return ['codeSigning'];
      case 'email': return ['emailProtection'];
      default: return [];
    }
  }

  private buildSANs(sans: string[]): x509.JsonGeneralNames {
    const entries: x509.JsonGeneralNames = [];
    for (const san of sans) {
      if (san.includes('@')) {
        entries.push({ type: 'email', value: san });
      } else if (/^[\d.]+$/.test(san) || san.includes(':')) {
        entries.push({ type: 'ip', value: san });
      } else if (san.startsWith('http://') || san.startsWith('https://')) {
        entries.push({ type: 'url', value: san });
      } else {
        entries.push({ type: 'dns', value: san });
      }
    }
    return entries;
  }

  private pemToBuffer(pem: string, label: string): ArrayBuffer {
    const base64 = pem
      .replace(`-----BEGIN ${label}-----`, '')
      .replace(`-----END ${label}-----`, '')
      .replace(/\s/g, '');
    const binary = Buffer.from(base64, 'base64');
    return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  }
}
