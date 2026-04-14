import { and, eq, lte } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { sslCertificates } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { AlertService } from '@/modules/audit/alert.service.js';
import type { SSLService } from '@/modules/ssl/ssl.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';

const logger = createChildLogger('ACMERenewalJob');

const RENEWAL_WINDOW_DAYS = 30;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export class ACMERenewalJob {
  private eventBus?: EventBusService;

  constructor(
    private readonly db: DrizzleClient,
    private readonly sslService: SSLService,
    private readonly alertService: AlertService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  async run(): Promise<void> {
    logger.info('Starting ACME certificate renewal check');

    const threshold = new Date();
    threshold.setDate(threshold.getDate() + RENEWAL_WINDOW_DAYS);

    // Query certificates that are eligible for auto-renewal
    const certsToRenew = await this.db.query.sslCertificates.findMany({
      where: and(
        eq(sslCertificates.autoRenew, true),
        eq(sslCertificates.type, 'acme'),
        eq(sslCertificates.status, 'active'),
        lte(sslCertificates.notAfter, threshold)
      ),
      columns: {
        privateKeyPem: false,
        encryptedDek: false,
        dekIv: false,
        acmeAccountKey: false,
      },
    });

    if (certsToRenew.length === 0) {
      logger.info('No certificates need renewal');
      return;
    }

    logger.info(`Found ${certsToRenew.length} certificate(s) eligible for renewal`);

    let renewed = 0;
    let failed = 0;
    let manualRequired = 0;

    for (const cert of certsToRenew) {
      try {
        if (cert.acmeChallengeType === 'http-01') {
          // Automatic renewal via HTTP-01 challenge
          await this.sslService.renewCert(cert.id, SYSTEM_USER_ID);
          renewed++;
          logger.info(`Renewed certificate: ${cert.name}`, { certId: cert.id, domains: cert.domainNames });
        } else if (cert.acmeChallengeType === 'dns-01') {
          // DNS-01 requires manual intervention
          await this.alertService.createAlert({
            type: 'expiry_warning',
            resourceType: 'ssl_certificate',
            resourceId: cert.id,
            message: `Certificate "${cert.name}" (DNS-01) is expiring on ${cert.notAfter?.toISOString()} and requires manual renewal. DNS-01 certificates cannot be auto-renewed.`,
          });
          manualRequired++;
          logger.warn(`DNS-01 certificate requires manual renewal: ${cert.name}`, { certId: cert.id });
        }
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to renew certificate: ${cert.name}`, { certId: cert.id, error: message });

        // Create an alert for the failure
        await this.alertService.createAlert({
          type: 'expiry_critical',
          resourceType: 'ssl_certificate',
          resourceId: cert.id,
          message: `Auto-renewal failed for certificate "${cert.name}": ${message}`,
        });
        this.eventBus?.publish('ssl.cert.changed', { id: cert.id, action: 'renewal_failed', name: cert.name });
      }
    }

    logger.info('ACME renewal job completed', { renewed, failed, manualRequired, total: certsToRenew.length });
  }
}
