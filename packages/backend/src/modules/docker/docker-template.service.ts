import { desc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerTemplates } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';

export class DockerTemplateService {
  private eventBus?: EventBusService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  private emitTemplate(id: string, action: string) {
    this.eventBus?.publish('docker.template.changed', { id, action });
  }

  async list() {
    return this.db.select().from(dockerTemplates).orderBy(desc(dockerTemplates.createdAt));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(dockerTemplates).where(eq(dockerTemplates.id, id)).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker template not found');
    return row;
  }

  async create(input: { name: string; description?: string; config: object }, userId: string) {
    const [row] = await this.db
      .insert(dockerTemplates)
      .values({
        name: input.name,
        description: input.description ?? null,
        config: input.config,
        createdBy: userId,
      })
      .returning();

    await this.auditService.log({
      action: 'docker.template.create',
      userId,
      resourceType: 'docker-template',
      resourceId: row.id,
      details: { name: input.name },
    });

    this.emitTemplate(row.id, 'created');
    return row;
  }

  async update(id: string, input: { name?: string; description?: string; config?: object }, userId: string) {
    // Verify exists
    await this.get(id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.config !== undefined) updates.config = input.config;

    const [row] = await this.db.update(dockerTemplates).set(updates).where(eq(dockerTemplates.id, id)).returning();

    await this.auditService.log({
      action: 'docker.template.update',
      userId,
      resourceType: 'docker-template',
      resourceId: id,
      details: { name: input.name },
    });

    this.emitTemplate(id, 'updated');
    return row;
  }

  async delete(id: string, userId: string) {
    const template = await this.get(id);

    await this.db.delete(dockerTemplates).where(eq(dockerTemplates.id, id));

    await this.auditService.log({
      action: 'docker.template.delete',
      userId,
      resourceType: 'docker-template',
      resourceId: id,
      details: { name: template.name },
    });

    this.emitTemplate(id, 'deleted');
  }
}
