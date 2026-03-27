import { injectable, inject } from 'tsyringe';
import { desc, eq, and, gte, lte } from 'drizzle-orm';
import { TOKENS } from '@/container.js';
import { auditLog } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';
import type { PaginatedResponse } from '@/types.js';

const logger = createChildLogger('AuditService');

export interface AuditEntry {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@injectable()
export class AuditService {
  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        details: entry.details,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      });
    } catch (error) {
      logger.error('Failed to write audit log', { error, entry });
    }
  }

  async getAuditLog(params: {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<typeof auditLog.$inferSelect>> {
    const conditions = [];
    if (params.action) conditions.push(eq(auditLog.action, params.action));
    if (params.resourceType) conditions.push(eq(auditLog.resourceType, params.resourceType));
    if (params.resourceId) conditions.push(eq(auditLog.resourceId, params.resourceId));
    if (params.from) conditions.push(gte(auditLog.createdAt, params.from));
    if (params.to) conditions.push(lte(auditLog.createdAt, params.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [entries, [{ count: totalCount }]] = await Promise.all([
      this.db.query.auditLog.findMany({
        where: where ? () => where : undefined,
        orderBy: [desc(auditLog.createdAt)],
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
      }),
      this.db.select({ count: (await import('drizzle-orm')).count() }).from(auditLog).where(where),
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
}
