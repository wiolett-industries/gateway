import { createChildLogger } from '@/lib/logger.js';
import type { DomainsService } from '@/modules/domains/domain.service.js';

const logger = createChildLogger('DnsCheckJob');

export class DnsCheckJob {
  constructor(private readonly domainsService: DomainsService) {}

  async run(): Promise<void> {
    logger.debug('Running DNS checks for all domains');
    try {
      await this.domainsService.checkAllDns();
    } catch (error) {
      logger.error('DNS check job failed', { error });
    }
  }
}
