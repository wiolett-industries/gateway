import { count as countFn, desc, eq, gte, lte } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { auditLog, users } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere } from '@/lib/utils.js';
import type { PaginatedResponse } from '@/types.js';
import { getAuditRequestContext, markAuditEmitted } from './audit-request-context.js';

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
      const requestContext = getAuditRequestContext();
      await this.db.insert(auditLog).values({
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        details: entry.details,
        ipAddress: entry.ipAddress ?? requestContext?.ipAddress,
        userAgent: entry.userAgent ?? requestContext?.userAgent,
      });
      markAuditEmitted();
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

    const where = buildWhere(conditions);

    const [entries, [{ count: totalCount }]] = await Promise.all([
      this.db
        .select({
          id: auditLog.id,
          userId: auditLog.userId,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          details: auditLog.details,
          ipAddress: auditLog.ipAddress,
          userAgent: auditLog.userAgent,
          createdAt: auditLog.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ count: countFn() }).from(auditLog).where(where),
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
