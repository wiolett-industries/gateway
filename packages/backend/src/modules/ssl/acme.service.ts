import crypto from 'node:crypto';
import * as x509 from '@peculiar/x509';
import * as acme from 'acme-client';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('ACMEService');

x509.cryptoProvider.set(crypto.webcrypto as any);

export class ACMEService {
  /** Set by bootstrap to deploy challenge files to the correct nginx node via daemon.
   *  `domains` is passed so the callback can look up which node hosts those domains. */
  onChallengeCreate?: (token: string, content: string, domains: string[]) => Promise<void>;
  onChallengeRemove?: (token: string, domains: string[]) => Promise<void>;

  constructor(
    private readonly acmeEmail: string | undefined,
    private readonly staging: boolean
  ) {}

  private getAcmeEmail(): string {
    if (!this.acmeEmail) {
      throw new Error('ACME_EMAIL must be configured to use ACME certificate issuance');
    }
    return this.acmeEmail;
  }

  /**
   * Request a certificate via HTTP-01 challenge (fully automatic).
   */
  async requestCertHTTP01(
    domains: string[],
    staging?: boolean
  ): Promise<{
    certificatePem: string;
    privateKeyPem: string;
    chainPem: string;
    notBefore: Date;
    notAfter: Date;
    accountKey: string;
  }> {
    logger.info('Requesting ACME cert via HTTP-01', { domains });

    // 1. Create account key
    const accountKey = await acme.crypto.createPrivateKey();

    // 2. Create ACME client
    const client = new acme.Client({
      directoryUrl: this.getDirectoryUrl(staging),
      accountKey,
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${this.getAcmeEmail()}`],
    });

    // 3. Create order
    const order = await client.createOrder({
      identifiers: domains.map((d) => ({ type: 'dns' as const, value: d })),
    });

    // 4. Process authorizations
    const authorizations = await client.getAuthorizations(order);
    const challengeCleanups: string[] = [];

    try {
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c) => c.type === 'http-01');
        if (!challenge) {
          throw new Error(`No HTTP-01 challenge found for ${authz.identifier.value}`);
        }

        // 5. Write challenge token
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

        if (!/^[A-Za-z0-9_-]+$/.test(challenge.token)) {
          throw new Error('Invalid ACME challenge token format');
        }

        // Challenge file is deployed to nginx node via the daemon
        // The caller (SSLService) must deploy the challenge before calling this method
        // or pass a challengeCreateFn. For now, we use a callback if provided.
        if (this.onChallengeCreate) {
          await this.onChallengeCreate(challenge.token, keyAuthorization, domains);
          challengeCleanups.push(challenge.token);
        }

        logger.debug('Challenge token written', { domain: authz.identifier.value, token: challenge.token });

        // 6. Verify and complete challenge
        await client.verifyChallenge(authz, challenge);
        await client.completeChallenge(challenge);
        await client.waitForValidStatus(challenge);
      }

      // 7. Finalize order with CSR
      const [key, csr] = await acme.crypto.createCsr({
        commonName: domains[0],
        altNames: domains,
      });

      const finalized = await client.finalizeOrder(order, csr);
      const certPem = await client.getCertificate(finalized);

      // 8. Parse certificate to extract dates
      const { notBefore, notAfter } = this.parseCertDates(certPem);

      // 9. Split cert and chain
      const { certificate, chain } = this.splitCertChain(certPem);

      logger.info('ACME HTTP-01 certificate obtained', { domains, notAfter });

      return {
        certificatePem: certificate,
        privateKeyPem: key.toString(),
        chainPem: chain,
        notBefore,
        notAfter,
        accountKey: accountKey.toString(),
      };
    } finally {
      // 10. Clean up challenge tokens via daemon
      for (const token of challengeCleanups) {
        try {
          if (this.onChallengeRemove) {
            await this.onChallengeRemove(token, domains);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Start DNS-01 challenge — returns records user must create.
   * Does NOT verify yet; user must create TXT records first.
   */
  async requestCertDNS01Start(
    domains: string[],
    staging?: boolean
  ): Promise<{
    accountKey: string;
    orderUrl: string;
    challenges: Array<{
      domain: string;
      recordName: string;
      recordValue: string;
    }>;
  }> {
    logger.info('Starting ACME DNS-01 challenge', { domains });

    // 1. Create account key
    const accountKey = await acme.crypto.createPrivateKey();

    // 2. Create ACME client
    const client = new acme.Client({
      directoryUrl: this.getDirectoryUrl(staging),
      accountKey,
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${this.getAcmeEmail()}`],
    });

    // 3. Create order
    const order = await client.createOrder({
      identifiers: domains.map((d) => ({ type: 'dns' as const, value: d })),
    });

    // 4. Get DNS-01 challenges
    const authorizations = await client.getAuthorizations(order);
    const challenges: Array<{
      domain: string;
      recordName: string;
      recordValue: string;
    }> = [];

    for (const authz of authorizations) {
      const challenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (!challenge) {
        throw new Error(`No DNS-01 challenge found for ${authz.identifier.value}`);
      }

      const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

      challenges.push({
        domain: authz.identifier.value,
        recordName: `_acme-challenge.${authz.identifier.value}`,
        recordValue: keyAuthorization,
      });
    }

    logger.info('DNS-01 challenges prepared', { domains, challengeCount: challenges.length });

    return {
      accountKey: accountKey.toString(),
      orderUrl: order.url,
      challenges,
    };
  }

  /**
   * Complete DNS-01 challenge after user creates TXT records.
   */
  async requestCertDNS01Verify(
    accountKeyPem: string,
    orderUrl: string,
    domains: string[],
    staging?: boolean
  ): Promise<{
    certificatePem: string;
    privateKeyPem: string;
    chainPem: string;
    notBefore: Date;
    notAfter: Date;
  }> {
    logger.info('Completing ACME DNS-01 verification', { domains });

    // 1. Recreate ACME client with saved account key
    const client = new acme.Client({
      directoryUrl: this.getDirectoryUrl(staging),
      accountKey: Buffer.from(accountKeyPem),
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${this.getAcmeEmail()}`],
    });

    // 2. Get existing order
    const order = await client.getOrder({ url: orderUrl } as any);

    // 3. Verify challenges
    const authorizations = await client.getAuthorizations(order);

    for (const authz of authorizations) {
      const challenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (!challenge) {
        throw new Error(`No DNS-01 challenge found for ${authz.identifier.value}`);
      }

      await client.verifyChallenge(authz, challenge);
      await client.completeChallenge(challenge);
      await client.waitForValidStatus(challenge);
    }

    // 4. Finalize order with CSR
    const [key, csr] = await acme.crypto.createCsr({
      commonName: domains[0],
      altNames: domains,
    });

    const finalized = await client.finalizeOrder(order, csr);
    const certPem = await client.getCertificate(finalized);

    // 5. Parse certificate dates
    const { notBefore, notAfter } = this.parseCertDates(certPem);

    // 6. Split cert and chain
    const { certificate, chain } = this.splitCertChain(certPem);

    logger.info('ACME DNS-01 certificate obtained', { domains, notAfter });

    return {
      certificatePem: certificate,
      privateKeyPem: key.toString(),
      chainPem: chain,
      notBefore,
      notAfter,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getDirectoryUrl(staging?: boolean): string {
    const useStaging = staging !== undefined ? staging : this.staging;
    return useStaging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production;
  }

  /**
   * Parse notBefore/notAfter from a PEM certificate using @peculiar/x509.
   */
  private parseCertDates(certPem: string): { notBefore: Date; notAfter: Date } {
    // Extract the first certificate from the PEM bundle
    const match = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
    if (!match) {
      throw new Error('Failed to parse certificate PEM');
    }

    const cert = new x509.X509Certificate(match[0]);
    return {
      notBefore: cert.notBefore,
      notAfter: cert.notAfter,
    };
  }

  /**
   * Split a full-chain PEM into the leaf certificate and the chain.
   */
  private splitCertChain(fullChainPem: string): { certificate: string; chain: string } {
    const certs = fullChainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certs || certs.length === 0) {
      throw new Error('No certificates found in PEM');
    }

    const certificate = certs[0];
    const chain = certs.slice(1).join('\n');

    return { certificate, chain };
  }
}
