import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { TOKENS } from '@/container.js';
import { alerts } from '@/db/schema/index.js';
import type { DrizzleClient } from '@/db/client.js';

@injectable()
export class AlertService {
  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  async getAlerts(dismissed = false) {
    return this.db.query.alerts.findMany({
      where: eq(alerts.dismissed, dismissed),
      orderBy: (alerts, { desc }) => [desc(alerts.createdAt)],
    });
  }

  async dismissAlert(alertId: string): Promise<void> {
    await this.db
      .update(alerts)
      .set({ dismissed: true })
      .where(eq(alerts.id, alertId));
  }

  async createAlert(data: {
    type: 'expiry_warning' | 'expiry_critical' | 'ca_expiry' | 'revocation';
    resourceType: string;
    resourceId: string;
    message: string;
  }): Promise<void> {
    await this.db.insert(alerts).values(data);
  }
}
