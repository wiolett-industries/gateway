import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { TOKENS } from '@/container.js';
import { certificateTemplates } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { CreateTemplateInput, UpdateTemplateInput } from './templates.schemas.js';

const logger = createChildLogger('TemplatesService');

const BUILTIN_TEMPLATES = [
  {
    name: 'TLS Server',
    description: 'Standard TLS/SSL server certificate for HTTPS',
    certType: 'tls-server' as const,
    keyAlgorithm: 'ecdsa-p256' as const,
    validityDays: 365,
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'],
    requireSans: true,
    sanTypes: ['dns', 'ip'],
  },
  {
    name: 'TLS Client',
    description: 'Client authentication certificate for mutual TLS',
    certType: 'tls-client' as const,
    keyAlgorithm: 'ecdsa-p256' as const,
    validityDays: 365,
    keyUsage: ['digitalSignature'],
    extKeyUsage: ['clientAuth'],
    requireSans: false,
    sanTypes: ['dns', 'email'],
  },
  {
    name: 'Code Signing',
    description: 'Certificate for signing code and software packages',
    certType: 'code-signing' as const,
    keyAlgorithm: 'ecdsa-p256' as const,
    validityDays: 365,
    keyUsage: ['digitalSignature'],
    extKeyUsage: ['codeSigning'],
    requireSans: false,
    sanTypes: [] as string[],
  },
  {
    name: 'Email / S/MIME',
    description: 'Certificate for email encryption and signing (S/MIME)',
    certType: 'email' as const,
    keyAlgorithm: 'ecdsa-p256' as const,
    validityDays: 365,
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['emailProtection'],
    requireSans: true,
    sanTypes: ['email'],
  },
];

@injectable()
export class TemplatesService {
  private eventBus?: EventBusService;

  constructor(@inject(TOKENS.DrizzleClient) private readonly db: DrizzleClient) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  private emitTemplate(id: string, action: string) {
    this.eventBus?.publish('pki.template.changed', { id, action });
  }

  async seedBuiltinTemplates(): Promise<void> {
    for (const template of BUILTIN_TEMPLATES) {
      const existing = await this.db.query.certificateTemplates.findFirst({
        where: (t, { and, eq }) => and(eq(t.name, template.name), eq(t.isBuiltin, true)),
      });

      if (!existing) {
        await this.db.insert(certificateTemplates).values({
          ...template,
          isBuiltin: true,
        });
        logger.info('Seeded built-in template', { name: template.name });
      }
    }
  }

  async listTemplates() {
    return this.db.query.certificateTemplates.findMany({
      orderBy: (t, { asc }) => [asc(t.name)],
    });
  }

  async getTemplate(id: string) {
    return this.db.query.certificateTemplates.findFirst({
      where: eq(certificateTemplates.id, id),
    });
  }

  async createTemplate(input: CreateTemplateInput, userId: string) {
    const [template] = await this.db.insert(certificateTemplates).values({
      ...input,
      createdById: userId,
    }).returning();
    this.emitTemplate(template.id, 'created');
    return template;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput) {
    const existing = await this.getTemplate(id);
    if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    if (existing.isBuiltin) throw new AppError(403, 'BUILTIN_IMMUTABLE', 'Built-in templates cannot be modified');

    const [updated] = await this.db
      .update(certificateTemplates)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(certificateTemplates.id, id))
      .returning();
    this.emitTemplate(id, 'updated');
    return updated;
  }

  async deleteTemplate(id: string) {
    const existing = await this.getTemplate(id);
    if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    if (existing.isBuiltin) throw new AppError(403, 'BUILTIN_IMMUTABLE', 'Built-in templates cannot be deleted');

    await this.db.delete(certificateTemplates).where(eq(certificateTemplates.id, id));
    this.emitTemplate(id, 'deleted');
  }
}
