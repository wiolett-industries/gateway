import { and, count, desc, eq, lt, ne, type SQL } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { notificationDeliveryLog, notificationWebhooks } from '@/db/schema/index.js';
import { buildWhere } from '@/lib/utils.js';

interface DeliveryListQuery {
  page: number;
  limit: number;
  webhookId?: string;
  status?: string;
  eventType?: string;
}

export class NotificationDeliveryService {
  constructor(private db: DrizzleClient) {}

  async list(query: DeliveryListQuery) {
    const conditions: SQL[] = [];

    if (query.webhookId) {
      conditions.push(eq(notificationDeliveryLog.webhookId, query.webhookId));
    }
    if (query.status) {
      conditions.push(eq(notificationDeliveryLog.status, query.status));
    }
    if (query.eventType) {
      conditions.push(eq(notificationDeliveryLog.eventType, query.eventType));
    }

    const where = buildWhere(conditions);
    const [totalResult] = await this.db.select({ count: count() }).from(notificationDeliveryLog).where(where);
    const total = totalResult?.count ?? 0;

    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .select({
        id: notificationDeliveryLog.id,
        webhookId: notificationDeliveryLog.webhookId,
        webhookName: notificationWebhooks.name,
        eventType: notificationDeliveryLog.eventType,
        severity: notificationDeliveryLog.severity,
        requestUrl: notificationDeliveryLog.requestUrl,
        requestMethod: notificationDeliveryLog.requestMethod,
        requestBody: notificationDeliveryLog.requestBody,
        responseStatus: notificationDeliveryLog.responseStatus,
        responseBody: notificationDeliveryLog.responseBody,
        responseTimeMs: notificationDeliveryLog.responseTimeMs,
        attempt: notificationDeliveryLog.attempt,
        maxAttempts: notificationDeliveryLog.maxAttempts,
        nextRetryAt: notificationDeliveryLog.nextRetryAt,
        status: notificationDeliveryLog.status,
        error: notificationDeliveryLog.error,
        createdAt: notificationDeliveryLog.createdAt,
        completedAt: notificationDeliveryLog.completedAt,
      })
      .from(notificationDeliveryLog)
      .leftJoin(notificationWebhooks, eq(notificationDeliveryLog.webhookId, notificationWebhooks.id))
      .where(where)
      .orderBy(desc(notificationDeliveryLog.createdAt))
      .limit(query.limit)
      .offset(offset);

    return {
      data: rows,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(id: string) {
    const [row] = await this.db
      .select()
      .from(notificationDeliveryLog)
      .where(eq(notificationDeliveryLog.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Get deliveries pending retry (nextRetryAt <= now) */
  async getPendingRetries(limit: number) {
    return this.db
      .select()
      .from(notificationDeliveryLog)
      .where(and(eq(notificationDeliveryLog.status, 'retrying'), lt(notificationDeliveryLog.nextRetryAt, new Date())))
      .limit(limit);
  }

  /** Clean old delivery log entries (for housekeeping) */
  async cleanOldEntries(retentionDays: number): Promise<number> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - retentionDays);

    const result = await this.db
      .delete(notificationDeliveryLog)
      .where(and(lt(notificationDeliveryLog.createdAt, threshold), ne(notificationDeliveryLog.status, 'retrying')))
      .returning({ id: notificationDeliveryLog.id });

    return result.length;
  }

  /** Delivery stats for UI dashboard */
  async getStats(webhookId?: string) {
    const conditions: SQL[] = [];
    if (webhookId) {
      conditions.push(eq(notificationDeliveryLog.webhookId, webhookId));
    }

    const where = buildWhere(conditions);

    const [totalResult] = await this.db.select({ count: count() }).from(notificationDeliveryLog).where(where);
    const [successResult] = await this.db
      .select({ count: count() })
      .from(notificationDeliveryLog)
      .where(buildWhere([...conditions, eq(notificationDeliveryLog.status, 'success')]));
    const [failedResult] = await this.db
      .select({ count: count() })
      .from(notificationDeliveryLog)
      .where(buildWhere([...conditions, eq(notificationDeliveryLog.status, 'failed')]));
    const [retryingResult] = await this.db
      .select({ count: count() })
      .from(notificationDeliveryLog)
      .where(buildWhere([...conditions, eq(notificationDeliveryLog.status, 'retrying')]));

    return {
      total: totalResult?.count ?? 0,
      success: successResult?.count ?? 0,
      failed: failedResult?.count ?? 0,
      retrying: retryingResult?.count ?? 0,
    };
  }
}
