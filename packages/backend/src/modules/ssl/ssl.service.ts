import crypto from 'node:crypto';
import { x509 } from '@/lib/x509.js';
import { and, count, desc, eq, ilike, lte, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { certificates, proxyHosts, sslCertificates } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere, escapeLike } from '@/lib/utils.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NginxConfigGenerator } from '@/services/nginx-config-generator.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { PaginatedResponse } from '@/types.js';
import type { ACMEService } from './acme.service.js';
import type { LinkInternalCertInput, RequestACMECertInput, SSLCertListQuery, UploadCertInput } from './ssl.schemas.js';

const logger = createChildLogger('SSLService');

export class SSLService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly acmeService: ACMEService,
    private readonly configGenerator: NginxConfigGenerator,
    private readonly cryptoService: CryptoService,
    private readonly auditService: AuditService,
    private readonly nodeDispatch: NodeDispatchService
  ) {}

  private eventBus?: EventBusService;
  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }
  private emitCert(id: string, action: 'created' | 'renewed' | 'deleted' | 'updated') {
    this.eventBus?.publish('ssl.cert.changed', { id, action });
  }

  // ---------------------------------------------------------------------------
  // ACME certificate request
  // ---------------------------------------------------------------------------

  async requestACMECert(input: RequestACMECertInput, userId: string) {
    const isStaging = input.provider === 'letsencrypt-staging';
    const name = input.domains[0];

    if (input.challengeType === 'http-01') {
      // Full automatic flow
      const result = await this.acmeService.requestCertHTTP01(input.domains, isStaging);

      // Encrypt private key before storing
      const encrypted = this.cryptoService.encryptPrivateKey(result.privateKeyPem);

      // Encrypt ACME account key before storing
      const acmeKeyEncrypted = this.cryptoService.encryptPrivateKey(result.accountKey);
      const acmeAccountKeyBlob = JSON.stringify({
        encrypted: acmeKeyEncrypted.encryptedPrivateKey,
        encryptedDek: acmeKeyEncrypted.encryptedDek,
        dekIv: acmeKeyEncrypted.dekIv,
      });

      const [cert] = await this.db
        .insert(sslCertificates)
        .values({
          name,
          type: 'acme',
          domainNames: input.domains,
          certificatePem: result.certificatePem,
          privateKeyPem: encrypted.encryptedPrivateKey,
          encryptedDek: encrypted.encryptedDek,
          dekIv: encrypted.dekIv,
          chainPem: result.chainPem,
          acmeProvider: input.provider,
          acmeChallengeType: 'http-01',
          acmeAccountKey: acmeAccountKeyBlob,
          notBefore: result.notBefore,
          notAfter: result.notAfter,
          autoRenew: input.autoRenew,
          status: 'active',
          createdById: userId,
        })
        .returning();

      // Deploy cert files to nginx
      try {
        await this.deployCertToDefaultNode(
          cert.id,
          result.certificatePem,
          result.privateKeyPem,
          result.chainPem || undefined
        );
      } catch (deployError) {
        const deployMessage = deployError instanceof Error ? deployError.message : 'Unknown deploy error';
        await this.db
          .update(sslCertificates)
          .set({
            status: 'error',
            renewalError: `Certificate deploy failed: ${deployMessage}`,
            updatedAt: new Date(),
          })
          .where(eq(sslCertificates.id, cert.id));
        throw deployError;
      }

      await this.auditService.log({
        userId,
        action: 'ssl.acme_request',
        resourceType: 'ssl_certificate',
        resourceId: cert.id,
        details: {
          domains: input.domains,
          challengeType: 'http-01',
          provider: input.provider,
        },
      });

      logger.info('ACME certificate issued via HTTP-01', { certId: cert.id, domains: input.domains });
      this.emitCert(cert.id, 'created');

      return {
        certificate: this.sanitizeCert(cert),
        status: 'issued' as const,
      };
    }

    // DNS-01: start flow, return challenges
    const result = await this.acmeService.requestCertDNS01Start(input.domains, isStaging);

    // Encrypt ACME account key before storing
    const dns01AcmeKeyEncrypted = this.cryptoService.encryptPrivateKey(result.accountKey);
    const dns01AcmeAccountKeyBlob = JSON.stringify({
      encrypted: dns01AcmeKeyEncrypted.encryptedPrivateKey,
      encryptedDek: dns01AcmeKeyEncrypted.encryptedDek,
      dekIv: dns01AcmeKeyEncrypted.dekIv,
    });

    // Save pending cert with ACME state
    const [cert] = await this.db
      .insert(sslCertificates)
      .values({
        name,
        type: 'acme',
        domainNames: input.domains,
        acmeProvider: input.provider,
        acmeChallengeType: 'dns-01',
        acmeAccountKey: dns01AcmeAccountKeyBlob,
        acmeOrderUrl: result.orderUrl,
        autoRenew: input.autoRenew,
        status: 'pending',
        createdById: userId,
      })
      .returning();

    await this.auditService.log({
      userId,
      action: 'ssl.acme_dns01_start',
      resourceType: 'ssl_certificate',
      resourceId: cert.id,
      details: {
        domains: input.domains,
        challengeType: 'dns-01',
        provider: input.provider,
      },
    });

    logger.info('ACME DNS-01 challenge started', { certId: cert.id, domains: input.domains });

    return {
      certificate: this.sanitizeCert(cert),
      status: 'pending_dns_verification' as const,
      challenges: result.challenges,
    };
  }

  // ---------------------------------------------------------------------------
  // Complete DNS-01 verification
  // ---------------------------------------------------------------------------

  async completeDNS01Verification(certId: string, userId: string) {
    const cert = await this.db.query.sslCertificates.findFirst({
      where: eq(sslCertificates.id, certId),
    });

    if (!cert) throw new AppError(404, 'SSL_CERT_NOT_FOUND', 'SSL certificate not found');
    if (cert.status !== 'pending')
      throw new AppError(400, 'NOT_PENDING', 'Certificate is not pending DNS verification');
    if (cert.acmeChallengeType !== 'dns-01')
      throw new AppError(400, 'NOT_DNS01', 'Certificate is not a DNS-01 challenge');
    if (!cert.acmeAccountKey || !cert.acmeOrderUrl) {
      throw new AppError(400, 'MISSING_ACME_STATE', 'Missing ACME state data for verification');
    }

    try {
      // Decrypt the stored ACME account key
      const acmeKeyBlob = JSON.parse(cert.acmeAccountKey);
      const decryptedAccountKey = this.cryptoService.decryptPrivateKey({
        encryptedPrivateKey: acmeKeyBlob.encrypted,
        encryptedDek: acmeKeyBlob.encryptedDek,
        dekIv: acmeKeyBlob.dekIv,
      });

      const dns01IsStaging = cert.acmeProvider === 'letsencrypt-staging';
      const result = await this.acmeService.requestCertDNS01Verify(
        decryptedAccountKey,
        cert.acmeOrderUrl,
        cert.domainNames,
        dns01IsStaging
      );

      // Encrypt private key
      const encrypted = this.cryptoService.encryptPrivateKey(result.privateKeyPem);

      // Update cert in DB
      await this.db
        .update(sslCertificates)
        .set({
          certificatePem: result.certificatePem,
          privateKeyPem: encrypted.encryptedPrivateKey,
          encryptedDek: encrypted.encryptedDek,
          dekIv: encrypted.dekIv,
          chainPem: result.chainPem,
          notBefore: result.notBefore,
          notAfter: result.notAfter,
          status: 'active',
          acmeOrderUrl: null, // Clear order URL after completion
          updatedAt: new Date(),
        })
        .where(eq(sslCertificates.id, certId));

      // Deploy to nginx — separate try/catch since cert is already valid at this point
      try {
        await this.deployCertToDefaultNode(
          certId,
          result.certificatePem,
          result.privateKeyPem,
          result.chainPem || undefined
        );
      } catch (deployError) {
        const deployMsg = deployError instanceof Error ? deployError.message : 'Unknown deploy error';
        logger.error('Certificate obtained but deploy to nginx failed', { certId, error: deployMsg });
        // Keep status as 'active' — cert is valid, just not deployed yet
        await this.db
          .update(sslCertificates)
          .set({
            renewalError: `Deploy failed: ${deployMsg}`,
            updatedAt: new Date(),
          })
          .where(eq(sslCertificates.id, certId));
        throw new AppError(500, 'DEPLOY_FAILED', `Certificate obtained but deploy failed: ${deployMsg}`);
      }

      await this.auditService.log({
        userId,
        action: 'ssl.acme_dns01_verify',
        resourceType: 'ssl_certificate',
        resourceId: certId,
        details: { domains: cert.domainNames },
      });

      logger.info('ACME DNS-01 certificate verified and issued', { certId, domains: cert.domainNames });

      const updated = await this.db.query.sslCertificates.findFirst({
        where: eq(sslCertificates.id, certId),
      });

      return this.sanitizeCert(updated!);
    } catch (error) {
      if (error instanceof AppError) throw error;
      // ACME verification itself failed — cert is not valid
      const message = error instanceof Error ? error.message : 'Unknown verification error';
      await this.db
        .update(sslCertificates)
        .set({
          status: 'error',
          renewalError: message,
          updatedAt: new Date(),
        })
        .where(eq(sslCertificates.id, certId));

      throw new AppError(400, 'DNS01_VERIFICATION_FAILED', `DNS-01 verification failed: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Upload certificate
  // ---------------------------------------------------------------------------

  async uploadCert(input: UploadCertInput, userId: string) {
    // Parse PEM to extract domains and validity dates
    let parsedCert: x509.X509Certificate;
    try {
      parsedCert = new x509.X509Certificate(input.certificatePem);
    } catch {
      throw new AppError(400, 'INVALID_CERT', 'Failed to parse certificate PEM');
    }

    // Check not expired
    if (parsedCert.notAfter < new Date()) {
      throw new AppError(400, 'CERT_EXPIRED', 'Certificate is already expired');
    }

    // Extract domains from SAN extension
    const domains = this.extractDomains(parsedCert);

    // Validate that the private key matches the certificate
    this.validateKeyMatchesCert(input.privateKeyPem, parsedCert);

    // Encrypt private key
    const encrypted = this.cryptoService.encryptPrivateKey(input.privateKeyPem);

    const [cert] = await this.db
      .insert(sslCertificates)
      .values({
        name: input.name,
        type: 'upload',
        domainNames: domains,
        certificatePem: input.certificatePem,
        privateKeyPem: encrypted.encryptedPrivateKey,
        encryptedDek: encrypted.encryptedDek,
        dekIv: encrypted.dekIv,
        chainPem: input.chainPem || null,
        notBefore: parsedCert.notBefore,
        notAfter: parsedCert.notAfter,
        autoRenew: false,
        status: 'active',
        createdById: userId,
      })
      .returning();

    // Deploy cert files to nginx
    try {
      await this.deployCertToDefaultNode(
        cert.id,
        input.certificatePem,
        input.privateKeyPem,
        input.chainPem || undefined
      );
    } catch (deployError) {
      const deployMessage = deployError instanceof Error ? deployError.message : 'Unknown deploy error';
      await this.db
        .update(sslCertificates)
        .set({
          status: 'error',
          renewalError: `Certificate deploy failed: ${deployMessage}`,
          updatedAt: new Date(),
        })
        .where(eq(sslCertificates.id, cert.id));
      throw deployError;
    }

    await this.auditService.log({
      userId,
      action: 'ssl.upload',
      resourceType: 'ssl_certificate',
      resourceId: cert.id,
      details: { name: input.name, domains },
    });

    logger.info('Certificate uploaded', { certId: cert.id, name: input.name, domains });
    this.emitCert(cert.id, 'created');

    return this.sanitizeCert(cert);
  }

  // ---------------------------------------------------------------------------
  // Link internal CA certificate
  // ---------------------------------------------------------------------------

  async linkInternalCert(input: LinkInternalCertInput, userId: string) {
    // Look up PKI certificate
    const pkiCert = await this.db.query.certificates.findFirst({
      where: eq(certificates.id, input.internalCertId),
    });

    if (!pkiCert) throw new AppError(404, 'PKI_CERT_NOT_FOUND', 'Internal PKI certificate not found');
    if (pkiCert.status !== 'active')
      throw new AppError(400, 'PKI_CERT_NOT_ACTIVE', 'Internal PKI certificate is not active');

    // Auto-generate name from cert CN if not provided
    const name = input.name || pkiCert.commonName;

    // Extract domains from the PKI cert
    let domains: string[] = [];
    try {
      const parsed = new x509.X509Certificate(pkiCert.certificatePem);
      domains = this.extractDomains(parsed);
    } catch {
      // Fallback to commonName
      if (pkiCert.commonName) {
        domains = [pkiCert.commonName];
      }
    }

    // We need the private key to deploy — decrypt it if available
    let privateKeyPem: string | null = null;
    if (pkiCert.encryptedPrivateKey && pkiCert.encryptedDek) {
      privateKeyPem = this.cryptoService.decryptPrivateKey({
        encryptedPrivateKey: pkiCert.encryptedPrivateKey,
        encryptedDek: pkiCert.encryptedDek,
        dekIv: pkiCert.dekIv || '',
      });
    }

    // Re-encrypt for the SSL cert entry
    let encryptedData: { encryptedPrivateKey: string; encryptedDek: string; dekIv: string } | null = null;
    if (privateKeyPem) {
      encryptedData = this.cryptoService.encryptPrivateKey(privateKeyPem);
    }

    const [cert] = await this.db
      .insert(sslCertificates)
      .values({
        name,
        type: 'internal',
        domainNames: domains,
        certificatePem: pkiCert.certificatePem,
        privateKeyPem: encryptedData?.encryptedPrivateKey || null,
        encryptedDek: encryptedData?.encryptedDek || null,
        dekIv: encryptedData?.dekIv || null,
        internalCertId: input.internalCertId,
        notBefore: pkiCert.notBefore,
        notAfter: pkiCert.notAfter,
        autoRenew: false,
        status: 'active',
        createdById: userId,
      })
      .returning();

    // Deploy the PKI cert's PEM to nginx cert files
    if (privateKeyPem) {
      await this.deployCertToDefaultNode(cert.id, pkiCert.certificatePem, privateKeyPem);
    }

    await this.auditService.log({
      userId,
      action: 'ssl.link_internal',
      resourceType: 'ssl_certificate',
      resourceId: cert.id,
      details: { internalCertId: input.internalCertId, name },
    });

    logger.info('Internal certificate linked', { certId: cert.id, internalCertId: input.internalCertId });
    this.emitCert(cert.id, 'created');

    return this.sanitizeCert(cert);
  }

  // ---------------------------------------------------------------------------
  // Renew certificate
  // ---------------------------------------------------------------------------

  async renewCert(certId: string, userId: string) {
    const cert = await this.db.query.sslCertificates.findFirst({
      where: eq(sslCertificates.id, certId),
    });

    if (!cert) throw new AppError(404, 'SSL_CERT_NOT_FOUND', 'SSL certificate not found');
    if (cert.type !== 'acme') throw new AppError(400, 'NOT_ACME', 'Only ACME certificates can be renewed');
    if (cert.status !== 'active' && cert.status !== 'error') {
      throw new AppError(400, 'CERT_NOT_RENEWABLE', 'Certificate is not in a renewable state');
    }

    try {
      let result: {
        certificatePem: string;
        privateKeyPem: string;
        chainPem: string;
        notBefore: Date;
        notAfter: Date;
        accountKey?: string;
      };

      if (cert.acmeChallengeType === 'http-01') {
        const renewIsStaging = cert.acmeProvider === 'letsencrypt-staging';
        result = await this.acmeService.requestCertHTTP01(cert.domainNames, renewIsStaging);
      } else {
        throw new AppError(
          400,
          'DNS01_NO_AUTO_RENEW',
          'DNS-01 certificates cannot be automatically renewed. Use the ACME request flow again.'
        );
      }

      // Encrypt private key
      const encrypted = this.cryptoService.encryptPrivateKey(result.privateKeyPem);

      // Encrypt updated ACME account key if present
      const renewUpdateData: Record<string, unknown> = {
        certificatePem: result.certificatePem,
        privateKeyPem: encrypted.encryptedPrivateKey,
        encryptedDek: encrypted.encryptedDek,
        dekIv: encrypted.dekIv,
        chainPem: result.chainPem,
        notBefore: result.notBefore,
        notAfter: result.notAfter,
        status: 'active',
        lastRenewedAt: new Date(),
        renewalError: null,
        updatedAt: new Date(),
      };

      if (result.accountKey) {
        const renewAcmeKeyEncrypted = this.cryptoService.encryptPrivateKey(result.accountKey);
        renewUpdateData.acmeAccountKey = JSON.stringify({
          encrypted: renewAcmeKeyEncrypted.encryptedPrivateKey,
          encryptedDek: renewAcmeKeyEncrypted.encryptedDek,
          dekIv: renewAcmeKeyEncrypted.dekIv,
        });
      }

      // Update cert data in DB
      await this.db.update(sslCertificates).set(renewUpdateData).where(eq(sslCertificates.id, certId));

      // Redeploy to nginx
      await this.deployCertToDefaultNode(
        certId,
        result.certificatePem,
        result.privateKeyPem,
        result.chainPem || undefined
      );

      await this.auditService.log({
        userId,
        action: 'ssl.renew',
        resourceType: 'ssl_certificate',
        resourceId: certId,
        details: { domains: cert.domainNames },
      });

      logger.info('Certificate renewed', { certId, domains: cert.domainNames });
      this.emitCert(certId, 'renewed');

      const updated = await this.db.query.sslCertificates.findFirst({
        where: eq(sslCertificates.id, certId),
      });

      return this.sanitizeCert(updated!);
    } catch (error) {
      if (error instanceof AppError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown renewal error';

      await this.db
        .update(sslCertificates)
        .set({
          status: 'error',
          renewalError: `Renewal failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(sslCertificates.id, certId));

      throw new AppError(500, 'RENEWAL_FAILED', `Certificate renewal failed: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete certificate
  // ---------------------------------------------------------------------------

  async deleteCert(certId: string, userId: string) {
    const cert = await this.db.query.sslCertificates.findFirst({
      where: eq(sslCertificates.id, certId),
    });

    if (!cert) throw new AppError(404, 'SSL_CERT_NOT_FOUND', 'SSL certificate not found');
    if (cert.isSystem) throw new AppError(403, 'SYSTEM_CERT', 'System certificates cannot be deleted');

    // Check no proxy hosts reference this cert
    const { proxyHosts } = await import('@/db/schema/index.js');
    const referencingHosts = await this.db.query.proxyHosts.findMany({
      where: eq(proxyHosts.sslCertificateId, certId),
      columns: { id: true, domainNames: true },
    });

    if (referencingHosts.length > 0) {
      throw new AppError(409, 'CERT_IN_USE', 'Certificate is in use by proxy hosts', {
        proxyHostIds: referencingHosts.map((h) => h.id),
      });
    }

    // Remove cert files from nginx
    await this.removeCertFromDefaultNode(certId);

    // Delete from DB
    await this.db.delete(sslCertificates).where(eq(sslCertificates.id, certId));

    await this.auditService.log({
      userId,
      action: 'ssl.delete',
      resourceType: 'ssl_certificate',
      resourceId: certId,
      details: { name: cert.name, domains: cert.domainNames },
    });

    logger.info('Certificate deleted', { certId, name: cert.name });
    this.emitCert(certId, 'deleted');
  }

  // ---------------------------------------------------------------------------
  // List certificates
  // ---------------------------------------------------------------------------

  async listCerts(params: SSLCertListQuery): Promise<PaginatedResponse<any>> {
    const conditions = [];

    if (params.type) conditions.push(eq(sslCertificates.type, params.type));
    if (params.status) conditions.push(eq(sslCertificates.status, params.status));
    if (params.search) {
      conditions.push(or(ilike(sslCertificates.name, `%${escapeLike(params.search)}%`))!);
    }

    const where = buildWhere(conditions);

    const [entries, [{ count: totalCount }]] = await Promise.all([
      this.db.query.sslCertificates.findMany({
        where: where ? () => where : undefined,
        orderBy: [desc(sslCertificates.createdAt)],
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
        columns: {
          privateKeyPem: false,
          encryptedDek: false,
          dekIv: false,
          acmeAccountKey: false,
        },
      }),
      this.db.select({ count: count() }).from(sslCertificates).where(where),
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

  // ---------------------------------------------------------------------------
  // Get single certificate
  // ---------------------------------------------------------------------------

  async getCert(certId: string) {
    const cert = await this.db.query.sslCertificates.findFirst({
      where: eq(sslCertificates.id, certId),
    });

    if (!cert) throw new AppError(404, 'SSL_CERT_NOT_FOUND', 'SSL certificate not found');

    return this.sanitizeCert(cert);
  }

  // ---------------------------------------------------------------------------
  // Get certificates expiring soon (for renewal job)
  // ---------------------------------------------------------------------------

  async getCertsExpiringSoon(days: number) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);

    return this.db.query.sslCertificates.findMany({
      where: and(
        eq(sslCertificates.status, 'active'),
        eq(sslCertificates.autoRenew, true),
        lte(sslCertificates.notAfter, threshold)
      ),
      columns: {
        privateKeyPem: false,
        encryptedDek: false,
        dekIv: false,
        acmeAccountKey: false,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract domain names from a certificate's Subject Alternative Names.
   */
  private extractDomains(cert: x509.X509Certificate): string[] {
    const domains: string[] = [];

    // Try SAN extension first
    const sanExtension = cert.extensions.find((ext) => ext.type === '2.5.29.17');

    if (sanExtension) {
      try {
        const san = new x509.SubjectAlternativeNameExtension(sanExtension.rawData);
        for (const name of san.names.items) {
          if (name.type === 'dns') {
            domains.push(name.value);
          }
        }
      } catch {
        // Fall through to CN extraction
      }
    }

    // Fallback: extract CN from subject
    if (domains.length === 0) {
      const cnMatch = cert.subject.match(/CN=([^,]+)/);
      if (cnMatch) {
        domains.push(cnMatch[1]);
      }
    }

    return domains;
  }

  /**
   * Validate that a private key matches a certificate's public key.
   */
  private validateKeyMatchesCert(privateKeyPem: string, cert: x509.X509Certificate): void {
    try {
      // Create a KeyObject from the private key to verify it's valid
      const keyObject = crypto.createPrivateKey(privateKeyPem);
      const publicKeyFromPrivate = crypto.createPublicKey(keyObject);

      // Export both public keys and compare
      const pubKeyFromPrivateDer = publicKeyFromPrivate.export({ type: 'spki', format: 'der' });
      const certPublicKeyDer = Buffer.from(cert.publicKey.rawData);

      if (!pubKeyFromPrivateDer.equals(certPublicKeyDer)) {
        throw new AppError(400, 'KEY_MISMATCH', 'Private key does not match the certificate');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_KEY', 'Failed to validate private key against certificate');
    }
  }

  /**
   * Strip sensitive fields from a certificate before returning to the client.
   */
  private sanitizeCert(cert: typeof sslCertificates.$inferSelect) {
    return {
      ...cert,
      privateKeyPem: undefined,
      encryptedDek: undefined,
      dekIv: undefined,
      acmeAccountKey: undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers — deploy certs via daemon
  // ---------------------------------------------------------------------------

  /**
   * Deploy a certificate to all nodes that have proxy hosts using it.
   * Falls back to the default node if no hosts reference the cert yet
   * (e.g., pre-deploying a cert before assigning it to a host).
   */
  private async deployCertToDefaultNode(
    certId: string,
    certPem: string,
    keyPem: string,
    chainPem?: string
  ): Promise<{ certPath: string; keyPath: string; chainPath?: string }> {
    const nodeIds = await this.resolveNodesForCert(certId);
    const certBuf = Buffer.from(certPem);
    const keyBuf = Buffer.from(keyPem);
    const chainBuf = chainPem ? Buffer.from(chainPem) : undefined;

    for (const nodeId of nodeIds) {
      await this.nodeDispatch.deployCertificate(nodeId, certId, certBuf, keyBuf, chainBuf);
    }
    return this.configGenerator.getCertPaths(certId);
  }

  private async removeCertFromDefaultNode(certId: string): Promise<void> {
    const nodeIds = await this.resolveNodesForCert(certId);
    for (const nodeId of nodeIds) {
      await this.nodeDispatch.removeCertificate(nodeId, certId);
    }
  }

  /** Find all distinct nodes that have proxy hosts using a given certificate. */
  private async resolveNodesForCert(certId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ nodeId: proxyHosts.nodeId })
      .from(proxyHosts)
      .where(eq(proxyHosts.sslCertificateId, certId));
    const nodeIds = rows.map((r) => r.nodeId).filter(Boolean) as string[];
    if (nodeIds.length > 0) return [...new Set(nodeIds)];
    // Fallback to default node for pre-deployment
    const defaultId = await this.nodeDispatch.getDefaultNodeId();
    return defaultId ? [defaultId] : [];
  }
}
