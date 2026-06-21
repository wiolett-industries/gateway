import type { TemplatesService } from '@/modules/pki/templates.service.js';
import type { User } from '@/types.js';

export const PKI_TEMPLATE_TOOL_NAMES = new Set([
  'list_templates',
  'create_template',
  'delete_template',
  'manage_template',
]);

export interface PkiTemplateToolContext {
  templatesService: TemplatesService;
  ensureToolScope(user: User, scope: string): void;
  ensureToolScopeForResource(user: User, baseScope: string, resourceId: string): void;
}

export async function executePkiTemplateTool(
  context: PkiTemplateToolContext,
  user: User,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const a = args as any;

  switch (toolName) {
    case 'list_templates':
      return context.templatesService.listTemplates();
    case 'create_template':
      return context.templatesService.createTemplate(
        {
          name: a.name,
          certType: a.type,
          keyAlgorithm: a.keyAlgorithm,
          validityDays: a.validityDays,
          keyUsage: a.keyUsage || [],
          extKeyUsage: a.extendedKeyUsage || [],
          requireSans: true,
          sanTypes: ['dns'],
          crlDistributionPoints: [],
          certificatePolicies: [],
          customExtensions: [],
        },
        user.id
      );
    case 'delete_template':
      await context.templatesService.deleteTemplate(a.templateId);
      return { success: true };
    case 'manage_template':
      if (a.operation === 'get') {
        context.ensureToolScopeForResource(user, 'pki:templates:view', String(a.templateId));
        return context.templatesService.getTemplate(a.templateId);
      }
      if (a.operation === 'update') {
        context.ensureToolScope(user, 'pki:templates:edit');
        return context.templatesService.updateTemplate(a.templateId, {
          name: a.name,
          certType: a.type,
          keyAlgorithm: a.keyAlgorithm,
          validityDays: a.validityDays,
          keyUsage: a.keyUsage,
          extKeyUsage: a.extendedKeyUsage,
        });
      }
      throw new Error(`Unsupported PKI template operation: ${String(a.operation)}`);
    default:
      throw new Error(`Unsupported PKI template tool: ${toolName}`);
  }
}
