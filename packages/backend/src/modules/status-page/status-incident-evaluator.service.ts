import { asc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { statusPageServices } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { StatusPageService, StatusPageServiceStatus } from './status-page.service.js';

const logger = createChildLogger('StatusIncidentEvaluator');

function isUnhealthy(status: StatusPageServiceStatus): boolean {
  return status === 'degraded' || status === 'outage';
}

export class StatusIncidentEvaluatorService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly statusPageService: StatusPageService
  ) {}

  async run(now = new Date()): Promise<void> {
    const services = await this.db.query.statusPageServices.findMany({
      where: eq(statusPageServices.enabled, true),
      orderBy: [asc(statusPageServices.sortOrder)],
    });
    if (services.length === 0) return;

    const sources = await this.statusPageService.resolveSources(services);
    for (const service of services) {
      const source = sources.get(service.id);
      const status = source?.status ?? 'unknown';
      const update: Partial<typeof statusPageServices.$inferInsert> = {
        lastEvaluatedStatus: status,
        updatedAt: now,
      };

      if (isUnhealthy(status)) {
        const unhealthySince = service.unhealthySince ?? now;
        update.unhealthySince = unhealthySince;
        update.healthySince = null;
        const unhealthyForMs = now.getTime() - unhealthySince.getTime();
        if (unhealthyForMs >= service.createThresholdSeconds * 1000) {
          await this.statusPageService.createAutomaticIncident(service, status);
        }
      } else if (status === 'operational') {
        const healthySince = service.healthySince ?? now;
        update.healthySince = healthySince;
        update.unhealthySince = null;
        const healthyForMs = now.getTime() - healthySince.getTime();
        if (healthyForMs >= service.resolveThresholdSeconds * 1000) {
          await this.statusPageService.autoResolveIncident(service.id);
        }
      } else {
        update.healthySince = null;
        update.unhealthySince = null;
      }

      await this.db.update(statusPageServices).set(update).where(eq(statusPageServices.id, service.id));
    }

    logger.debug('Status page incident evaluation complete', { count: services.length });
  }
}
