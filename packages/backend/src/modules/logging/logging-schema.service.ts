import { asc, eq, ilike, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { type LoggingFieldDefinition, loggingSchemas } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CreateLoggingSchemaInput, UpdateLoggingSchemaInput } from './logging.schemas.js';
import type { LoggingSchemaView } from './logging-storage.types.js';

export class LoggingSchemaService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly auditService: AuditService
  ) {}

  async list(query?: { search?: string }): Promise<LoggingSchemaView[]> {
    const search = query?.search?.trim();
    const rows = await this.db
      .select()
      .from(loggingSchemas)
      .where(
        search ? or(ilike(loggingSchemas.name, `%${search}%`), ilike(loggingSchemas.slug, `%${search}%`)) : undefined
      )
      .orderBy(asc(loggingSchemas.name));
    return rows.map(toView);
  }

  async get(id: string): Promise<LoggingSchemaView> {
    const row = await this.findRaw(id);
    if (!row) throw new AppError(404, 'LOGGING_SCHEMA_NOT_FOUND', 'Logging schema not found');
    return toView(row);
  }

  async create(input: CreateLoggingSchemaInput, userId: string): Promise<LoggingSchemaView> {
    const [row] = await this.db
      .insert(loggingSchemas)
      .values({
        ...input,
        description: input.description ?? null,
        createdById: userId,
      })
      .returning();
    await this.auditService.log({
      userId,
      action: 'logging.schema.create',
      resourceType: 'logging-schema',
      resourceId: row.id,
      details: { name: row.name, slug: row.slug },
    });
    return toView(row);
  }

  async update(id: string, input: UpdateLoggingSchemaInput, userId: string): Promise<LoggingSchemaView> {
    const existing = await this.findRaw(id);
    if (!existing) throw new AppError(404, 'LOGGING_SCHEMA_NOT_FOUND', 'Logging schema not found');
    const [row] = await this.db
      .update(loggingSchemas)
      .set({
        ...input,
        description: input.description === undefined ? undefined : input.description,
        updatedAt: new Date(),
      })
      .where(eq(loggingSchemas.id, id))
      .returning();
    await this.auditService.log({
      userId,
      action: 'logging.schema.update',
      resourceType: 'logging-schema',
      resourceId: id,
      details: { name: row.name, slug: row.slug },
    });
    return toView(row);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.findRaw(id);
    if (!existing) throw new AppError(404, 'LOGGING_SCHEMA_NOT_FOUND', 'Logging schema not found');
    await this.db.delete(loggingSchemas).where(eq(loggingSchemas.id, id));
    await this.auditService.log({
      userId,
      action: 'logging.schema.delete',
      resourceType: 'logging-schema',
      resourceId: id,
      details: { name: existing.name, slug: existing.slug },
    });
  }

  private async findRaw(id: string) {
    const rows = await this.db.select().from(loggingSchemas).where(eq(loggingSchemas.id, id)).limit(1);
    return rows[0] ?? null;
  }
}

function toView(row: typeof loggingSchemas.$inferSelect): LoggingSchemaView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    schemaMode: row.schemaMode,
    fieldSchema: (row.fieldSchema ?? []) as LoggingFieldDefinition[],
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
