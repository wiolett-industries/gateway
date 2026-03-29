import { createChildLogger } from '@/lib/logger.js';
import type { UpdateService } from '@/services/update.service.js';

const logger = createChildLogger('UpdateCheckJob');

export class UpdateCheckJob {
  constructor(private readonly updateService: UpdateService) {}

  async run(): Promise<void> {
    logger.debug('Running scheduled update check');
    try {
      const status = await this.updateService.checkForUpdates();
      if (status.updateAvailable) {
        logger.info(`Update available: ${status.currentVersion} → ${status.latestVersion}`);
      }
    } catch (error) {
      logger.error('Update check failed', { error });
    }
  }
}
