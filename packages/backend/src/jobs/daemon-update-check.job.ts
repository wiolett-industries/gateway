import { createChildLogger } from '@/lib/logger.js';
import type { DaemonUpdateService } from '@/services/daemon-update.service.js';

const logger = createChildLogger('DaemonUpdateCheckJob');

export class DaemonUpdateCheckJob {
  constructor(private readonly service: DaemonUpdateService) {}

  async run(): Promise<void> {
    logger.debug('Running scheduled daemon update check');
    try {
      const statuses = await this.service.checkForUpdates();
      for (const s of statuses) {
        const outdated = s.nodes.filter((n) => n.updateAvailable);
        if (outdated.length > 0) {
          logger.info(
            `${s.daemonType} daemon update available: ${s.latestVersion} (${outdated.length} node(s) outdated)`
          );
        }
      }
    } catch (error) {
      logger.error('Daemon update check failed', { error });
    }
  }
}
