import { createChildLogger } from '@/lib/logger.js';
import type { NotificationDeliveryService } from '@/modules/notifications/notification-delivery.service.js';
import type { NotificationDispatcherService } from '@/modules/notifications/notification-dispatcher.service.js';

const logger = createChildLogger('NotificationRetryJob');

const BATCH_SIZE = 20;

export class NotificationRetryJob {
  constructor(
    private deliveryService: NotificationDeliveryService,
    private dispatcherService: NotificationDispatcherService
  ) {}

  async run(): Promise<void> {
    const pendingRetries = await this.deliveryService.getPendingRetries(BATCH_SIZE);

    if (pendingRetries.length === 0) return;

    logger.debug(`Processing ${pendingRetries.length} pending webhook retries`);

    const results = await Promise.allSettled(
      pendingRetries.map((delivery) => this.dispatcherService.retryDelivery(delivery.id))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn(`${failed.length} retry attempts threw errors`);
    }
  }
}
